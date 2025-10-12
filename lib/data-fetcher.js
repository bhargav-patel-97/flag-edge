import { AlpacaClient } from './alpaca-client.js';
import { createClient } from '@supabase/supabase-js';

export class DataFetcher {
  constructor() {
    this.alpaca = new AlpacaClient();
    
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

    console.log(`DataFetcher initialized with ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon'} key`);
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
        open: parseFloat(barData.o),
        high: parseFloat(barData.h),
        low: parseFloat(barData.l),
        close: parseFloat(barData.c),
        volume: parseInt(barData.v),
        trade_count: parseInt(barData.n),
        vwap: parseFloat(barData.vw)
      };

      console.log(`Storing bar record:`, barRecord);

      // Try upsert first if we have service role key
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const { data, error } = await this.supabase
            .from('minute_bars')
            .upsert(barRecord, { 
              onConflict: 'symbol,timestamp',
              ignoreDuplicates: false 
            })
            .select();

          if (error) {
            console.error('Upsert error, falling back to insert/update:', error);
            // Fall back to check-then-insert-or-update logic
            return await this.insertOrUpdateBar(barRecord, symbol, barData.t);
          }

          console.log(`Successfully upserted bar for ${symbol}`);
          return barRecord;
        } catch (upsertError) {
          console.error('Upsert failed, falling back to insert/update:', upsertError);
          return await this.insertOrUpdateBar(barRecord, symbol, barData.t);
        }
      } else {
        // Use insert/update logic for anon key
        return await this.insertOrUpdateBar(barRecord, symbol, barData.t);
      }
    } catch (error) {
      console.error('Error storing minute bar:', error);
      throw error;
    }
  }

  async insertOrUpdateBar(barRecord, symbol, timestamp) {
    try {
      // Check if record already exists
      const { data: existingRecord, error: selectError } = await this.supabase
        .from('minute_bars')
        .select('id')
        .eq('symbol', symbol)
        .eq('timestamp', timestamp)
        .maybeSingle(); // Use maybeSingle to avoid error when no record found

      if (selectError) {
        console.error('Error checking existing record:', selectError);
        throw selectError;
      }

      let result;
      if (existingRecord) {
        // Update existing record
        console.log(`Updating existing record for ${symbol} at ${timestamp}`);
        const { data, error } = await this.supabase
          .from('minute_bars')
          .update(barRecord)
          .eq('symbol', symbol)
          .eq('timestamp', timestamp)
          .select();
        
        if (error) throw error;
        result = data;
      } else {
        // Insert new record
        console.log(`Inserting new record for ${symbol} at ${timestamp}`);
        const { data, error } = await this.supabase
          .from('minute_bars')
          .insert(barRecord)
          .select();
        
        if (error) throw error;
        result = data;
      }

      console.log(`Successfully stored bar for ${symbol}`);
      return barRecord;
    } catch (error) {
      console.error('Error in insertOrUpdateBar:', error);
      throw error;
    }
  }

  // Method to test database connectivity and permissions
  async testConnection() {
    try {
      const { data, error } = await this.supabase
        .from('minute_bars')
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
