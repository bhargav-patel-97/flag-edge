import { AlpacaClient } from './alpaca-client.js';
import { createClient } from '@supabase/supabase-js';

export class DataFetcher {
  constructor() {
    this.alpaca = new AlpacaClient();
    // Use the standard Supabase client instead of custom wrapper
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }

  async fetchLatestBars(symbols = ['QQQ']) {
    try {
      console.log(`Fetching latest bars for symbols: ${symbols.join(', ')}`);
      
      const response = await this.alpaca.makeDataRequest('/v2/stocks/bars/latest', {
        symbols: symbols.join(','),
        feed: 'iex'
      });

      console.log('Received response from Alpaca:', response);

      if (!response.bars) {
        console.warn('No bars data in response');
        return response;
      }

      // Store each bar in the database
      for (const [symbol, barData] of Object.entries(response.bars)) {
        console.log(`Storing minute bar for ${symbol}:`, barData);
        await this.storeMinuteBar(symbol, barData);
      }

      return response;
    } catch (error) {
      console.error('Error fetching latest bars:', error);
      throw error;
    }
  }

  async storeMinuteBar(symbol, barData) {
    try {
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

      console.log(`Storing bar record:`, barRecord);

      const { data, error } = await this.supabase
        .from('minute_bars')
        .upsert(barRecord, { 
          onConflict: 'symbol,timestamp',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Database error:', error);
        throw error;
      }

      console.log(`Successfully stored bar for ${symbol}`);
      return barRecord;
    } catch (error) {
      console.error('Error storing minute bar:', error);
      throw error;
    }
  }
}
