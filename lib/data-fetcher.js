import { AlpacaClient } from './alpaca-client.js';
import { createClient } from '@supabase/supabase-js';

export class DataFetcher {
  constructor() {
    this.alpaca = new AlpacaClient();
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

      // Check if record already exists
      const { data: existingRecord } = await this.supabase
        .from('minute_bars')
        .select('id')
        .eq('symbol', symbol)
        .eq('timestamp', barData.t)
        .single();

      let result;
      if (existingRecord) {
        // Update existing record
        console.log(`Updating existing record for ${symbol} at ${barData.t}`);
        const { data, error } = await this.supabase
          .from('minute_bars')
          .update(barRecord)
          .eq('symbol', symbol)
          .eq('timestamp', barData.t);
        
        if (error) throw error;
        result = data;
      } else {
        // Insert new record
        console.log(`Inserting new record for ${symbol} at ${barData.t}`);
        const { data, error } = await this.supabase
          .from('minute_bars')
          .insert(barRecord);
        
        if (error) throw error;
        result = data;
      }

      console.log(`Successfully stored bar for ${symbol}`);
      return barRecord;
    } catch (error) {
      console.error('Error storing minute bar:', error);
      throw error;
    }
  }
}
