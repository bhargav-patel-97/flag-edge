export class EconomicCalendar {
  constructor() {
    this.apiKey = process.env.FINNHUB_API_KEY;
    this.baseUrl = 'https://finnhub.io/api/v1';
    
    // Cache for economic events to avoid repeated API calls
    this.eventCache = new Map();
    this.cacheExpiry = 6 * 60 * 60 * 1000; // 6 hours
  }

  async getTodaysEvents() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const events = await this.getEconomicCalendar(today, today);
      
      return events.filter(event => this.isHighImpactEvent(event));
    } catch (error) {
      console.error('Economic calendar error:', error);
      return []; // Return empty array to not block trading
    }
  }

  async getUpcomingEvents(hours = 2) {
    try {
      const now = new Date();
      const futureTime = new Date(now.getTime() + (hours * 60 * 60 * 1000));
      
      const startDate = now.toISOString().split('T')[0];
      const endDate = futureTime.toISOString().split('T')[0];
      
      const events = await this.getEconomicCalendar(startDate, endDate);
      
      return events.filter(event => {
        if (!this.isHighImpactEvent(event)) return false;
        
        const eventTime = new Date(event.time * 1000); // Finnhub returns timestamp
        return eventTime >= now && eventTime <= futureTime;
      });
    } catch (error) {
      console.error('Upcoming events error:', error);
      return [];
    }
  }

  async getEconomicCalendar(fromDate, toDate) {
    const cacheKey = `calendar_${fromDate}_${toDate}`;
    const cached = this.eventCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const url = `${this.baseUrl}/calendar/economic?from=${fromDate}&to=${toDate}&token=${this.apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn('Failed to fetch economic calendar data');
        return [];
      }
      
      const data = await response.json();
      const events = data.economicCalendar || [];
      
      // Transform Finnhub format to match original structure
      const transformedEvents = events.map(event => ({
        Date: new Date(event.time * 1000).toISOString(),
        Event: event.event,
        Country: event.country,
        Importance: this.mapFinnhubImportance(event.impact),
        Currency: this.getCountryCurrency(event.country),
        Actual: event.actual,
        Previous: event.prev,
        Forecast: event.estimate,
        Source: 'Finnhub',
        time: event.time,
        impact: event.impact
      }));
      
      this.eventCache.set(cacheKey, {
        data: transformedEvents,
        timestamp: Date.now()
      });
      
      return transformedEvents;
    } catch (error) {
      console.error('Failed to fetch economic calendar:', error);
      return [];
    }
  }

  mapFinnhubImportance(impact) {
    // Finnhub uses: 1 = Low, 2 = Medium, 3 = High
    switch (impact) {
      case 3: return 'High';
      case 2: return 'Medium';
      case 1: return 'Low';
      default: return 'Low';
    }
  }

  getCountryCurrency(country) {
    const currencyMap = {
      'US': 'USD',
      'United States': 'USD',
      'UK': 'GBP',
      'United Kingdom': 'GBP',
      'EU': 'EUR',
      'European Union': 'EUR',
      'Germany': 'EUR',
      'France': 'EUR',
      'Italy': 'EUR',
      'Spain': 'EUR',
      'Japan': 'JPY',
      'Canada': 'CAD',
      'Australia': 'AUD',
      'New Zealand': 'NZD',
      'Switzerland': 'CHF'
    };
    
    return currencyMap[country] || 'USD';
  }

  isHighImpactEvent(event) {
    const highImpactIndicators = [
      'Nonfarm Payrolls',
      'Non Farm Payrolls', 
      'Unemployment Rate',
      'Consumer Price Index',
      'CPI',
      'Federal Funds Rate',
      'Interest Rate Decision',
      'GDP',
      'Gross Domestic Product',
      'ISM Manufacturing',
      'PMI',
      'Retail Sales',
      'Consumer Confidence',
      'FOMC',
      'Fed Chair',
      'Powell Speech',
      'Core CPI',
      'PCE',
      'Core PCE',
      'Initial Jobless Claims'
    ];
    
    const eventName = event.Event?.toLowerCase() || '';
    
    return highImpactIndicators.some(indicator =>
      eventName.includes(indicator.toLowerCase())
    ) || event.Importance === 'High' || event.impact === 3;
  }

  shouldPauseTrading(events) {
    if (!events || events.length === 0) {
      return false;
    }
    
    const now = new Date();
    
    return events.some(event => {
      const eventTime = new Date(event.Date);
      const timeDiff = Math.abs(eventTime - now) / (1000 * 60); // Minutes
      
      // Pause 30 minutes before and after high impact events
      return timeDiff <= 30;
    });
  }

  getMarketImpactLevel(event) {
    const veryHighImpact = [
      'Nonfarm Payrolls',
      'Non Farm Payrolls',
      'Federal Funds Rate',
      'Interest Rate Decision',
      'FOMC Meeting',
      'Fed Chair Speech',
      'Powell Speech'
    ];
    
    const highImpact = [
      'Consumer Price Index',
      'CPI',
      'Core CPI',
      'GDP',
      'Unemployment Rate',
      'ISM Manufacturing',
      'PMI'
    ];
    
    const eventName = event.Event?.toLowerCase() || '';
    
    if (veryHighImpact.some(indicator => eventName.includes(indicator.toLowerCase()))) {
      return 'very_high';
    } else if (highImpact.some(indicator => eventName.includes(indicator.toLowerCase()))) {
      return 'high';
    }
    
    return 'medium';
  }

  // Additional method to get earnings calendar for major companies
  async getEarningsCalendar(fromDate, toDate) {
    try {
      const url = `${this.baseUrl}/calendar/earnings?from=${fromDate}&to=${toDate}&token=${this.apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      return data.earningsCalendar || [];
    } catch (error) {
      console.warn('Failed to fetch earnings calendar:', error);
      return [];
    }
  }

  // Method to check for major earnings that might affect overall market
  async checkMajorEarnings(hours = 24) {
    const now = new Date();
    const futureTime = new Date(now.getTime() + (hours * 60 * 60 * 1000));
    
    const startDate = now.toISOString().split('T')[0];
    const endDate = futureTime.toISOString().split('T')[0];
    
    try {
      const earnings = await this.getEarningsCalendar(startDate, endDate);
      
      // Filter for major companies that could affect overall market
      const majorCompanies = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'V', 'WMT'];
      
      return earnings.filter(earning => 
        majorCompanies.includes(earning.symbol)
      );
    } catch (error) {
      console.warn('Failed to check major earnings:', error);
      return [];
    }
  }
}