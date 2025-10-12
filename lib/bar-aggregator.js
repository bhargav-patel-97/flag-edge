import { createClient } from '@supabase/supabase-js';

export class BarAggregator {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
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

      // Group bars by timeframe buckets
      const buckets = this.groupIntoBuckets(minuteBars, timeframeMinutes);
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
    const minutes = timestamp.getMinutes();
    const bucketMinute = Math.floor(minutes / timeframeMinutes) * timeframeMinutes;
    return new Date(
      timestamp.getFullYear(), 
      timestamp.getMonth(), 
      timestamp.getDate(), 
      timestamp.getHours(), 
      bucketMinute, 
      0, 
      0
    );
  }

  createAggregatedBar(bucket, timeframe) {
    const { bars, timestamp } = bucket;
    if (!bars || bars.length === 0) return null;

    // Sort by timestamp to ensure correct order
    bars.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const totalVolume = bars.reduce((sum, b) => sum + b.volume, 0);
    const vwap = totalVolume > 0 
      ? bars.reduce((sum, b) => sum + (b.vwap * b.volume), 0) / totalVolume
      : 0;

    return {
      timeframe,
      timestamp: timestamp.toISOString(),
      open: bars[0].open,
      high: Math.max(...bars.map(b => b.high)),
      low: Math.min(...bars.map(b => b.low)),
      close: bars[bars.length - 1].close,
      volume: totalVolume,
      trade_count: bars.reduce((sum, b) => sum + b.trade_count, 0),
      vwap: vwap,
      bar_count: bars.length
    };
  }

  async storeAggregatedBar(symbol, barData) {
    try {
      // Check if record already exists
      const { data: existingRecord } = await this.supabase
        .from('aggregated_bars')
        .select('id')
        .eq('symbol', symbol)
        .eq('timeframe', barData.timeframe)
        .eq('timestamp', barData.timestamp)
        .single();

      let result;
      if (existingRecord) {
        // Update existing record
        console.log(`Updating existing ${barData.timeframe} bar for ${symbol} at ${barData.timestamp}`);
        const { data, error } = await this.supabase
          .from('aggregated_bars')
          .update({
            symbol,
            ...barData
          })
          .eq('symbol', symbol)
          .eq('timeframe', barData.timeframe)
          .eq('timestamp', barData.timestamp);
        
        if (error) throw error;
        result = data;
      } else {
        // Insert new record
        console.log(`Inserting new ${barData.timeframe} bar for ${symbol} at ${barData.timestamp}`);
        const { data, error } = await this.supabase
          .from('aggregated_bars')
          .insert({
            symbol,
            ...barData
          });
        
        if (error) throw error;
        result = data;
      }

      console.log(`Stored ${barData.timeframe} bar for ${symbol} at ${barData.timestamp}`);
      return result;
    } catch (error) {
      console.error('Error in storeAggregatedBar:', error);
      throw error;
    }
  }
}
