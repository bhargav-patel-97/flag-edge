import { SupabaseClient } from './supabase-client.js';

export class AlpacaClient {
  constructor() {
    this.apiKey = process.env.ALPACA_API_KEY;
    this.secretKey = process.env.ALPACA_SECRET_KEY;
    this.baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    this.dataUrl = 'https://data.alpaca.markets';
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
    // Use our database instead of Alpaca's delayed API
    const supabase = new SupabaseClient();

    const tableName = timeframe === '1Min' ? 'minute_bars' : 'aggregated_bars';

    let query = supabase.supabase
      .from(tableName)
      .select('*')
      .eq('symbol', symbol)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (timeframe !== '1Min') {
      // Convert timeframe format from "5Min" to "5m"
      const timeframeCode = timeframe.replace('Min', 'm');
      query = query.eq('timeframe', timeframeCode);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Convert to Alpaca format and return in chronological order
    return data.reverse().map(bar => ({
      timestamp: bar.timestamp,
      open: parseFloat(bar.open),
      high: parseFloat(bar.high),
      low: parseFloat(bar.low),
      close: parseFloat(bar.close),
      volume: parseInt(bar.volume)
    }));
  }
}