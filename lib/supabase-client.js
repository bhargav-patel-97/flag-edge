import { createClient } from '@supabase/supabase-js';

export class SupabaseClient {
  constructor() {
    // Use service role key when available for bypassing RLS, fallback to anon key
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

    console.log(`SupabaseClient initialized with ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon'} key`);
  }

  async logExecution(result) {
    try {
      const { data, error } = await this.supabase
        .from('strategy_executions')
        .insert([{
          timestamp: new Date().toISOString(),
          symbol: result.symbol,
          timeframe: result.timeframe,
          signals_generated: result.signals?.length || 0,
          trades_executed: result.trades?.length || 0,
          result: result
        }]);

      if (error) {
        console.error('Error logging execution:', error);
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Failed to log execution:', error);
      throw error;
    }
  }

  async logTrade(trade) {
    try {
      const { data, error } = await this.supabase
        .from('trades')
        .insert([{
          timestamp: new Date().toISOString(),
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          price: trade.price,
          option_contract: trade.optionContract,
          strategy: 'level_flag',
          entry_reason: trade.entryReason,
          exit_reason: trade.exitReason,
          pnl: trade.pnl,
          status: trade.status
        }]);

      if (error) {
        console.error('Error logging trade:', error);
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Failed to log trade:', error);
      throw error;
    }
  }

  async logError(error) {
    try {
      const { data, errorDb } = await this.supabase
        .from('error_logs')
        .insert([{
          timestamp: new Date().toISOString(),
          message: error.message,
          stack: error.stack,
          function_name: error.functionName || 'unknown'
        }]);

      if (errorDb) console.error('Failed to log error to database:', errorDb);
      return data;
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError);
      return null;
    }
  }

  async logEvent(event, data = {}) {
    try {
      const { data: result, error } = await this.supabase
        .from('system_events')
        .insert([{
          timestamp: new Date().toISOString(),
          event_type: event,
          data: data
        }]);

      if (error) {
        console.error('Error logging event:', error);
        throw error;
      }
      return result;
    } catch (error) {
      console.error('Failed to log event:', error);
      throw error;
    }
  }

  async getTodaysPnL() {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await this.supabase
        .from('trades')
        .select('pnl')
        .gte('timestamp', `${today}T00:00:00.000Z`)
        .lt('timestamp', `${today}T23:59:59.999Z`)
        .not('pnl', 'is', null);

      if (error) {
        console.error('Error getting today\'s PnL:', error);
        throw error;
      }

      return data.reduce((total, trade) => total + (trade.pnl || 0), 0);
    } catch (error) {
      console.error('Failed to get today\'s PnL:', error);
      return 0;
    }
  }

  async getRecentTrades(limit = 10) {
    try {
      const { data, error } = await this.supabase
        .from('trades')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting recent trades:', error);
        throw error;
      }
      return data || [];
    } catch (error) {
      console.error('Failed to get recent trades:', error);
      return [];
    }
  }

  async getAccountMetrics() {
    try {
      // Get metrics for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await this.supabase
        .from('trades')
        .select('pnl, timestamp')
        .gte('timestamp', thirtyDaysAgo.toISOString())
        .not('pnl', 'is', null);

      if (error) {
        console.error('Error getting account metrics:', error);
        throw error;
      }

      const totalPnL = data.reduce((sum, trade) => sum + trade.pnl, 0);
      const winningTrades = data.filter(trade => trade.pnl > 0).length;
      const totalTrades = data.length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      return {
        totalPnL,
        totalTrades,
        winRate,
        avgTradeReturn: totalTrades > 0 ? totalPnL / totalTrades : 0
      };
    } catch (error) {
      console.error('Failed to get account metrics:', error);
      return {
        totalPnL: 0,
        totalTrades: 0,
        winRate: 0,
        avgTradeReturn: 0
      };
    }
  }

  // Test database connectivity with better error reporting
  async testConnection() {
    try {
      console.log('Testing database connection...');
      const { data, error } = await this.supabase
        .from('minute_bars')
        .select('count')
        .limit(1);

      if (error) {
        console.error('Database connection test failed:', error);
        return { 
          success: false, 
          error: error.message,
          code: error.code,
          details: error.details || 'No additional details'
        };
      }

      console.log('Database connection test successful');
      return { 
        success: true, 
        message: 'Database connection working',
        keyType: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon'
      };
    } catch (error) {
      console.error('Database connection test error:', error);
      return { 
        success: false, 
        error: error.message,
        type: 'connection_error'
      };
    }
  }

  // Test data access for troubleshooting
  async testDataAccess(symbol = 'QQQ', limit = 5) {
    try {
      console.log(`Testing data access for ${symbol}...`);

      // Test minute_bars access
      const { data: minuteData, error: minuteError } = await this.supabase
        .from('minute_bars')
        .select('*')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(limit);

      // Test aggregated_bars access
      const { data: aggData, error: aggError } = await this.supabase
        .from('aggregated_bars')
        .select('*')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(limit);

      const result = {
        minute_bars: {
          count: minuteData?.length || 0,
          error: minuteError?.message || null,
          sample: minuteData?.slice(0, 2) || []
        },
        aggregated_bars: {
          count: aggData?.length || 0,
          error: aggError?.message || null,
          sample: aggData?.slice(0, 2) || []
        }
      };

      console.log('Data access test results:', result);
      return result;
    } catch (error) {
      console.error('Data access test failed:', error);
      return {
        error: error.message,
        minute_bars: { count: 0, error: error.message },
        aggregated_bars: { count: 0, error: error.message }
      };
    }
  }
}