
export class PolygonClient {
  constructor() {
    this.apiKey = process.env.POLYGON_API_KEY;
    if (!this.apiKey) {
      throw new Error('Missing POLYGON_API_KEY environment variable');
    }
    this.baseUrl = 'https://api.polygon.io';
  }

  async makeRequest(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    // Add API key to params
    params.apikey = this.apiKey;

    // Add all params to URL
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });

    console.log('Making Polygon API request to:', url.toString());

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Polygon API returned non-OK status: ${data.status}`);
    }

    return data;
  }

  /**
   * Fetch Simple Moving Average from Polygon.io
   * @param {string} symbol - Stock symbol (e.g., 'QQQ')
   * @param {number} window - Period for SMA (e.g., 200, 400)
   * @param {string} timespan - Timespan for aggregation ('day', 'week', 'month')
   * @param {string} seriesType - Price type ('close', 'open', 'high', 'low')
   * @param {number} limit - Number of results to return (max 5000)
   * @returns {Promise<Object>} SMA data from Polygon
   */
  async getSMA(symbol, window = 200, timespan = 'day', seriesType = 'close', limit = 10) {
    try {
      console.log(`Fetching ${window}-period SMA for ${symbol} from Polygon.io`);

      const endpoint = `/v1/indicators/sma/${symbol}`;
      const params = {
        window: window,
        timespan: timespan,
        series_type: seriesType,
        limit: limit,
        order: 'desc' // Get most recent values first
      };

      const response = await this.makeRequest(endpoint, params);

      if (!response.results?.values || response.results.values.length === 0) {
        console.warn(`No SMA data returned for ${symbol} with window ${window}`);
        return null;
      }

      // Return the most recent SMA value and all historical values
      return {
        symbol,
        window,
        timespan,
        seriesType,
        currentValue: response.results.values[0]?.value || null,
        timestamp: response.results.values[0]?.timestamp || null,
        values: response.results.values,
        underlying: response.results.underlying || null
      };

    } catch (error) {
      console.error(`Error fetching SMA for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Fetch both 200-day and 400-day SMAs for a symbol
   * @param {string} symbol - Stock symbol
   * @param {string} timespan - Timespan for aggregation
   * @param {string} seriesType - Price type
   * @returns {Promise<Object>} Object containing both SMAs
   */
  async getLongTermSMAs(symbol, timespan = 'day', seriesType = 'close') {
    try {
      console.log(`Fetching long-term SMAs (200 & 400 day) for ${symbol}`);

      // Fetch both SMAs in parallel
      const [sma200, sma400] = await Promise.all([
        this.getSMA(symbol, 200, timespan, seriesType, 5),
        this.getSMA(symbol, 400, timespan, seriesType, 5)
      ]);

      return {
        symbol,
        timespan,
        seriesType,
        sma200: sma200 ? {
          value: sma200.currentValue,
          timestamp: sma200.timestamp,
          historicalValues: sma200.values
        } : null,
        sma400: sma400 ? {
          value: sma400.currentValue,
          timestamp: sma400.timestamp,
          historicalValues: sma400.values
        } : null,
        fetchedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error fetching long-term SMAs for ${symbol}:`, error);
      throw error;
    }
  }
}
