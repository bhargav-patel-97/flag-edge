import { createClient } from '@supabase/supabase-js';

export class BarAggregator {
  constructor() {
    // Use service role key for bypassing RLS when available, fallback to anon key
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseKey) {
      throw new Error('Missing Supabase keys: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      supabaseKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    console.log(`BarAggregator initialized with ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon'} key`);
  }

  async aggregateToTimeframe(symbol, timeframe, lookbackMinutes = 60) {
    try {
      console.log(`Aggregating ${symbol} to ${timeframe} timeframe`);

      const timeframeMinutes = this.parseTimeframe(timeframe);
      const endTime = new Date();
      const startTime = new Date(endTime - lookbackMinutes * 60 * 1000);

      console.log(`Looking for bars between ${startTime.toISOString()} and ${endTime.toISOString()}`);

      // Get minute bars from database
      const { data: minuteBars, error } = await this.supabase
        .from('minute_bars')
        .select('*')
        .eq('symbol', symbol)
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Database error fetching minute bars:', error);
        throw error;
      }

      console.log(`Found ${minuteBars?.length || 0} minute bars`);

      if (!minuteBars || minuteBars.length === 0) {
        console.log('No minute bars found for aggregation');
        return [];
      }

      // Filter bars based on market session if needed
      const filteredBars = this.filterBarsForMarketSession(minuteBars, timeframe);
      console.log(`Using ${filteredBars.length} bars after market session filtering`);

      // Group bars by timeframe buckets
      const buckets = this.groupIntoBuckets(filteredBars, timeframeMinutes);
      console.log(`Created ${buckets.length} buckets for ${timeframe}`);

      const aggregatedBars = buckets.map(bucket => this.createAggregatedBar(bucket, timeframe))
        .filter(bar => bar !== null);

      console.log(`Generated ${aggregatedBars.length} aggregated bars`);

      // Store aggregated bars
      for (const bar of aggregatedBars) {
        await this.storeAggregatedBar(symbol, bar);
      }

      return aggregatedBars;
    } catch (error) {
      console.error('Error in aggregateToTimeframe:', error);
      throw error;
    }
  }

  filterBarsForMarketSession(bars, timeframe) {
    // For market hours-specific aggregation, filter bars based on Eastern Time
    const now = new Date();
    const todayET = new Date().toLocaleString("en-US", {timeZone: "America/New_York"});
    const todayETDate = new Date(todayET).toISOString().split('T')[0];

    return bars.filter(bar => {
      const barTime = new Date(bar.timestamp);
      const barET = barTime.toLocaleString("en-US", {timeZone: "America/New_York"});
      const barETTime = new Date(barET);

      const hour = barETTime.getHours();
      const minute = barETTime.getMinutes();
      const timeInMinutes = hour * 60 + minute;

      // Market is open from 9:30 AM to 4:00 PM ET (but we extend strategy to 4:30)
      const marketOpen = 9 * 60 + 30; // 9:30 AM
      const marketClose = 16 * 60; // 4:00 PM

      // Check if it's a weekday
      const dayOfWeek = barETTime.getDay();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

      // Check if during market hours
      const isDuringMarketHours = timeInMinutes >= marketOpen && timeInMinutes <= marketClose;

      // For specific timeframes, we might want to be more selective
      if (timeframe === '2m') {
        // 2min bars should focus on opening session (9:30-10:00 AM)
        const openingEnd = 10 * 60; // 10:00 AM
        return isWeekday && timeInMinutes >= marketOpen && timeInMinutes < openingEnd;
      } else if (timeframe === '5m') {
        // 5min bars should focus on morning session (10:00-11:00 AM)
        const morningStart = 10 * 60; // 10:00 AM
        const morningEnd = 11 * 60; // 11:00 AM
        return isWeekday && timeInMinutes >= morningStart && timeInMinutes < morningEnd;
      } else if (timeframe === '10m') {
        // 10min bars for regular session (11:00 AM-4:30 PM)
        const regularStart = 11 * 60; // 11:00 AM
        return isWeekday && timeInMinutes >= regularStart && timeInMinutes <= marketClose;
      }

      // Default: return all market hours bars
      return isWeekday && isDuringMarketHours;
    });
  }

  parseTimeframe(timeframe) {
    const match = timeframe.match(/(\d+)m/);
    return match ? parseInt(match[1]) : 1;
  }

  groupIntoBuckets(bars, timeframeMinutes) {
    const buckets = new Map();

    bars.forEach(bar => {
      const timestamp = new Date(bar.timestamp);
      const bucketStart = this.getBucketStart(timestamp, timeframeMinutes);
      const bucketKey = bucketStart.toISOString();

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { timestamp: bucketStart, bars: [] });
      }

      buckets.get(bucketKey).bars.push(bar);
    });

    return Array.from(buckets.values());
  }

  getBucketStart(timestamp, timeframeMinutes) {
    // Convert to Eastern Time for proper market session alignment
    const easternTime = new Date(timestamp.toLocaleString("en-US", {timeZone: "America/New_York"}));

    const minutes = easternTime.getMinutes();
    const bucketMinute = Math.floor(minutes / timeframeMinutes) * timeframeMinutes;

    const bucketStart = new Date(
      easternTime.getFullYear(), 
      easternTime.getMonth(), 
      easternTime.getDate(), 
      easternTime.getHours(), 
      bucketMinute, 
      0, 
      0
    );

    // Convert back to UTC for storage
    return new Date(bucketStart.toLocaleString("en-US", {timeZone: "UTC"}));
  }

  createAggregatedBar(bucket, timeframe) {
    const { bars, timestamp } = bucket;

    if (!bars || bars.length === 0) return null;

    // Sort by timestamp to ensure correct order
    bars.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const totalVolume = bars.reduce((sum, b) => sum + parseInt(b.volume), 0);
    const vwap = totalVolume > 0 
      ? bars.reduce((sum, b) => sum + (parseFloat(b.vwap) * parseInt(b.volume)), 0) / totalVolume
      : 0;

    return {
      timeframe,
      timestamp: timestamp.toISOString(),
      open: parseFloat(bars[0].open),
      high: Math.max(...bars.map(b => parseFloat(b.high))),
      low: Math.min(...bars.map(b => parseFloat(b.low))),
      close: parseFloat(bars[bars.length - 1].close),
      volume: totalVolume,
      trade_count: bars.reduce((sum, b) => sum + parseInt(b.trade_count), 0),
      vwap: parseFloat(vwap.toFixed(6)),
      bar_count: bars.length
    };
  }

  async storeAggregatedBar(symbol, barData) {
    try {
      const aggregatedRecord = {
        symbol,
        timeframe: barData.timeframe,
        timestamp: barData.timestamp,
        open: barData.open,
        high: barData.high,
        low: barData.low,
        close: barData.close,
        volume: barData.volume,
        trade_count: barData.trade_count,
        vwap: barData.vwap,
        bar_count: barData.bar_count
      };

      // Try upsert first if we have service role key
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const { data, error } = await this.supabase
            .from('aggregated_bars')
            .upsert(aggregatedRecord, { 
              onConflict: 'symbol,timeframe,timestamp',
              ignoreDuplicates: false 
            })
            .select();

          if (error) {
            console.error('Upsert error, falling back to insert/update:', error);
            // Fall back to check-then-insert-or-update logic
            return await this.insertOrUpdateAggregatedBar(aggregatedRecord);
          }

          console.log(`Successfully upserted ${barData.timeframe} bar for ${symbol} at ${barData.timestamp}`);
          return aggregatedRecord;
        } catch (upsertError) {
          console.error('Upsert failed, falling back to insert/update:', upsertError);
          return await this.insertOrUpdateAggregatedBar(aggregatedRecord);
        }
      } else {
        // Use insert/update logic for anon key
        return await this.insertOrUpdateAggregatedBar(aggregatedRecord);
      }

    } catch (error) {
      console.error('Error in storeAggregatedBar:', error);
      throw error;
    }
  }

  async insertOrUpdateAggregatedBar(aggregatedRecord) {
    try {
      // Check if record already exists
      const { data: existingRecord, error: selectError } = await this.supabase
        .from('aggregated_bars')
        .select('id')
        .eq('symbol', aggregatedRecord.symbol)
        .eq('timeframe', aggregatedRecord.timeframe)
        .eq('timestamp', aggregatedRecord.timestamp)
        .maybeSingle(); // Use maybeSingle to avoid error when no record found

      if (selectError) {
        console.error('Error checking existing aggregated record:', selectError);
        throw selectError;
      }

      let result;
      if (existingRecord) {
        // Update existing record
        console.log(`Updating existing ${aggregatedRecord.timeframe} bar for ${aggregatedRecord.symbol} at ${aggregatedRecord.timestamp}`);
        const { data, error } = await this.supabase
          .from('aggregated_bars')
          .update(aggregatedRecord)
          .eq('symbol', aggregatedRecord.symbol)
          .eq('timeframe', aggregatedRecord.timeframe)
          .eq('timestamp', aggregatedRecord.timestamp)
          .select();

        if (error) throw error;
        result = data;
      } else {
        // Insert new record
        console.log(`Inserting new ${aggregatedRecord.timeframe} bar for ${aggregatedRecord.symbol} at ${aggregatedRecord.timestamp}`);
        const { data, error } = await this.supabase
          .from('aggregated_bars')
          .insert(aggregatedRecord)
          .select();

        if (error) throw error;
        result = data;
      }

      console.log(`Stored ${aggregatedRecord.timeframe} bar for ${aggregatedRecord.symbol} at ${aggregatedRecord.timestamp}`);
      return result;
    } catch (error) {
      console.error('Error in insertOrUpdateAggregatedBar:', error);
      throw error;
    }
  }

  // Method to test database connectivity and permissions
  async testConnection() {
    try {
      const { data, error } = await this.supabase
        .from('aggregated_bars')
        .select('count')
        .limit(1);

      if (error) {
        console.error('Database connection test failed:', error);
        return { success: false, error: error.message };
      }

      console.log('Database connection test successful');
      return { success: true, message: 'Database connection working' };
    } catch (error) {
      console.error('Database connection test error:', error);
      return { success: false, error: error.message };
    }
  }
}