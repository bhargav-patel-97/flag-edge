import { AlpacaClient } from './alpaca-client.js';
import { SupabaseClient } from './supabase-client.js';

export class DataFetcher {
  constructor() {
    this.alpaca = new AlpacaClient();
    this.supabase = new SupabaseClient();
  }

  async fetchLatestBars(symbols = ['QQQ']) {
    try {
      const response = await this.alpaca.makeDataRequest('/v2/stocks/bars/latest', {
        symbols: symbols.join(','),
        feed: 'iex'
      });

      // Store each bar in the database
      for (const [symbol, barData] of Object.entries(response.bars)) {
        await this.storeMinuteBar(symbol, barData);
      }

      return response;
    } catch (error) {
      console.error('Error fetching latest bars:', error);
      throw error;
    }
  }

  async storeMinuteBar(symbol, barData) {
    const barRecord = {
      symbol,
      timestamp: barData.t,
      open: barData.o,
      high: barData.h,
      low: barData.l,
      close: barData.c,
      volume: barData.v,
      trade_count: barData.n,
      vwap: barData.vw
    };

    const { error } = await this.supabase
      .from('minute_bars')
      .upsert(barRecord, { onConflict: 'symbol,timestamp' });

    if (error) throw error;
    return barRecord;
  }
}