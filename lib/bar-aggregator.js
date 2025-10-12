import { SupabaseClient } from './supabase-client.js';

export class BarAggregator {
  constructor() {
    this.supabase = new SupabaseClient();
  }

  async aggregateToTimeframe(symbol, timeframe, lookbackMinutes = 60) {
    const timeframeMinutes = this.parseTimeframe(timeframe);
    const endTime = new Date();
    const startTime = new Date(endTime - lookbackMinutes * 60 * 1000);

    // Get minute bars from database
    const { data: minuteBars, error } = await this.supabase
      .from('minute_bars')
      .select('*')
      .eq('symbol', symbol)
      .gte('timestamp', startTime.toISOString())
      .lte('timestamp', endTime.toISOString())
      .order('timestamp', { ascending: true });

    if (error) throw error;
    if (!minuteBars.length) return [];

    // Group bars by timeframe buckets
    const buckets = this.groupIntoBuckets(minuteBars, timeframeMinutes);
    const aggregatedBars = buckets.map(bucket => this.createAggregatedBar(bucket, timeframe));

    // Store aggregated bars
    for (const bar of aggregatedBars) {
      await this.storeAggregatedBar(symbol, bar);
    }

    return aggregatedBars;
  }

  parseTimeframe(timeframe) {
    const match = timeframe.match(/(\d+)m/);
    return match ? parseInt(match) : 1;
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
    return new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate(), timestamp.getHours(), bucketMinute, 0, 0);
  }

  createAggregatedBar(bucket, timeframe) {
    const { bars, timestamp } = bucket;
    if (!bars.length) return null;

    bars.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      timeframe,
      timestamp: timestamp.toISOString(),
      open: bars.open,
      high: Math.max(...bars.map(b => b.high)),
      low: Math.min(...bars.map(b => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + b.volume, 0),
      trade_count: bars.reduce((sum, b) => sum + b.trade_count, 0),
      vwap: this.calculateVWAP(bars),
      bar_count: bars.length
    };
  }

  calculateVWAP(bars) {
    const totalVolume = bars.reduce((sum, b) => sum + b.volume, 0);
    if (totalVolume === 0) return 0;
    
    const weightedSum = bars.reduce((sum, b) => sum + (b.vwap * b.volume), 0);
    return weightedSum / totalVolume;
  }

  async storeAggregatedBar(symbol, barData) {
    const { error } = await this.supabase
      .from('aggregated_bars')
      .upsert({
        symbol,
        ...barData
      }, { onConflict: 'symbol,timeframe,timestamp' });

    if (error) throw error;
  }
}