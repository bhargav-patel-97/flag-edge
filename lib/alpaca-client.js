import { createClient } from '@supabase/supabase-js';

export class AlpacaClient {
  constructor() {
    this.apiKey = process.env.ALPACA_API_KEY;
    this.secretKey = process.env.ALPACA_SECRET_KEY;
    this.baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    this.dataUrl = 'https://data.alpaca.markets';

    // Initialize Supabase client with service role key for data access
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

    console.log(`AlpacaClient initialized with ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon'} key for database access`);
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`Alpaca API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async makeDataRequest(endpoint, params = {}) {
    const url = new URL(`${this.dataUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.append(key, value);
    });

    const headers = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Alpaca Data API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getAccount() {
    return this.makeRequest('/v2/account');
  }

  async getPositions() {
    return this.makeRequest('/v2/positions');
  }

  async getOrders(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.makeRequest(`/v2/orders?${queryString}`);
  }

  async getBars({ symbols, timeframe = '5Min', start, end, limit = 100 }) {
    const params = {
      symbols: symbols.join(','),
      timeframe,
      limit
    };
    if (start) params.start = start;
    if (end) params.end = end;

    const response = await this.makeDataRequest('/v2/stocks/bars', params);
    return response.bars[symbols[0]] || [];
  }

  async getOptionChain(symbol) {
    return this.makeRequest(`/v2/options/contracts?underlying_symbol=${symbol}&status=active`);
  }

  async submitOrder(orderData) {
    return this.makeRequest('/v2/orders', {
      method: 'POST',
      body: JSON.stringify(orderData)
    });
  }

  async getQuotes(symbols) {
    const response = await this.makeDataRequest('/v2/stocks/quotes/latest', {
      symbols: symbols.join(',')
    });
    return response.quotes;
  }

  async getBarsFromDatabase(symbol, timeframe = '5Min', limit = 100) {
    try {
      console.log(`Fetching ${limit} bars for ${symbol} with timeframe ${timeframe} from database`);

      // Normalize timeframe format
      const normalizedTimeframe = this.normalizeTimeframe(timeframe);
      console.log(`Normalized timeframe from ${timeframe} to ${normalizedTimeframe}`);

      // Determine which table to query
      const tableName = normalizedTimeframe === '1m' ? 'minute_bars' : 'aggregated_bars';
      console.log(`Querying table: ${tableName}`);

      // Build the query
      let query = this.supabase
        .from(tableName)
        .select('*')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(limit);

      // Add timeframe filter for aggregated bars
      if (tableName === 'aggregated_bars') {
        query = query.eq('timeframe', normalizedTimeframe);
        console.log(`Added timeframe filter: ${normalizedTimeframe}`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Database query error:', error);
        throw new Error(`Database query failed: ${error.message} (Code: ${error.code})`);
      }

      console.log(`Database query returned ${data?.length || 0} records`);

      if (!data || data.length === 0) {
        console.warn(`No data found for symbol: ${symbol}, timeframe: ${normalizedTimeframe}, table: ${tableName}`);

        // Try to get some debug information
        await this.debugDatabaseContent(symbol, tableName, normalizedTimeframe);

        return [];
      }

      // Convert to Alpaca format and return in chronological order
      const convertedData = data.reverse().map(bar => ({
        timestamp: bar.timestamp,
        open: parseFloat(bar.open),
        high: parseFloat(bar.high),
        low: parseFloat(bar.low),
        close: parseFloat(bar.close),
        volume: parseInt(bar.volume),
        trade_count: bar.trade_count ? parseInt(bar.trade_count) : undefined,
        vwap: bar.vwap ? parseFloat(bar.vwap) : undefined
      }));

      console.log(`Successfully retrieved and converted ${convertedData.length} bars`);
      console.log(`Date range: ${convertedData[0]?.timestamp} to ${convertedData[convertedData.length - 1]?.timestamp}`);

      return convertedData;
    } catch (error) {
      console.error('Error in getBarsFromDatabase:', error);
      throw error;
    }
  }

  // Helper method to normalize timeframe formats
  normalizeTimeframe(timeframe) {
    const timeframeMap = {
      '1Min': '1m',
      '2Min': '2m', 
      '5Min': '5m',
      '10Min': '10m',
      '15Min': '15m',
      '30Min': '30m',
      '1H': '1h',
      '1D': '1d',
      // Also handle if already in correct format
      '1m': '1m',
      '2m': '2m',
      '5m': '5m', 
      '10m': '10m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '1d': '1d'
    };

    return timeframeMap[timeframe] || timeframe;
  }

  // Debug method to help troubleshoot data availability
  async debugDatabaseContent(symbol, tableName, timeframe = null) {
    try {
      console.log(`=== DEBUG: Checking ${tableName} content ===`);

      // Check total records
      const { count: totalCount, error: countError } = await this.supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (countError) {
        console.error('Error counting records:', countError);
      } else {
        console.log(`Total records in ${tableName}: ${totalCount}`);
      }

      // Check records for this symbol
      let symbolQuery = this.supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol);

      const { count: symbolCount, error: symbolError } = await symbolQuery;

      if (symbolError) {
        console.error(`Error counting ${symbol} records:`, symbolError);
      } else {
        console.log(`Records for ${symbol}: ${symbolCount}`);
      }

      // For aggregated bars, check timeframe breakdown
      if (tableName === 'aggregated_bars') {
        const { data: timeframeData, error: tfError } = await this.supabase
          .from(tableName)
          .select('timeframe')
          .eq('symbol', symbol);

        if (!tfError && timeframeData) {
          const timeframes = [...new Set(timeframeData.map(d => d.timeframe))];
          console.log(`Available timeframes for ${symbol}:`, timeframes);

          if (timeframe && !timeframes.includes(timeframe)) {
            console.warn(`Requested timeframe '${timeframe}' not available. Available: ${timeframes.join(', ')}`);
          }
        }
      }

      // Get most recent records for debugging
      const { data: recentData, error: recentError } = await this.supabase
        .from(tableName)
        .select('timestamp, symbol, timeframe')
        .order('timestamp', { ascending: false })
        .limit(5);

      if (!recentError && recentData) {
        console.log('Most recent records:', recentData);
      }

      console.log(`=== END DEBUG ===`);
    } catch (debugError) {
      console.error('Debug query failed:', debugError.message);
    }
  }

  // Test database connectivity specifically for data access
  async testDatabaseConnection() {
    try {
      console.log('Testing database connection for market data access...');

      const { data, error } = await this.supabase
        .from('minute_bars')
        .select('count')
        .limit(1);

      if (error) {
        console.error('Database connection test failed:', error);
        return { 
          success: false, 
          error: error.message,
          suggestion: 'Check RLS policies and database permissions'
        };
      }

      console.log('Database connection test successful');
      return { 
        success: true, 
        message: 'Database connection working for market data access',
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
}