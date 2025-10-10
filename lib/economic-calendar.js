export class EconomicCalendar {
    constructor() {
        this.apiKey = process.env.TRADING_ECONOMICS_KEY;
        this.baseUrl = 'https://api.tradingeconomics.com';
    }

    async getTodaysEvents() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const url = `${this.baseUrl}/calendar/country/united%20states/${today}?c=${this.apiKey}&f=json`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn('Failed to fetch economic calendar data');
                return [];
            }
            
            const events = await response.json();
            
            return events.filter(event => this.isHighImpactEvent(event));
        } catch (error) {
            console.error('Economic calendar error:', error);
            return []; // Return empty array to not block trading
        }
    }

    isHighImpactEvent(event) {
        const highImpactIndicators = [
            'Non Farm Payrolls',
            'Unemployment Rate',
            'Consumer Price Index',
            'Federal Funds Rate',
            'GDP',
            'ISM Manufacturing PMI',
            'Retail Sales',
            'Consumer Confidence',
            'FOMC Meeting Minutes',
            'Fed Chair Speech'
        ];
        
        return highImpactIndicators.some(indicator => 
            event.Event?.toLowerCase().includes(indicator.toLowerCase())
        ) || event.Importance === 'High';
    }

    async getUpcomingEvents(hours = 2) {
        try {
            const now = new Date();
            const futureTime = new Date(now.getTime() + (hours * 60 * 60 * 1000));
            
            const startDate = now.toISOString().split('T')[0];
            const endDate = futureTime.toISOString().split('T')[0];
            
            const url = `${this.baseUrl}/calendar/country/united%20states/${startDate}/${endDate}?c=${this.apiKey}&f=json`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                return [];
            }
            
            const events = await response.json();
            
            return events.filter(event => {
                const eventTime = new Date(event.Date);
                return eventTime >= now && eventTime <= futureTime && this.isHighImpactEvent(event);
            });
        } catch (error) {
            console.error('Upcoming events error:', error);
            return [];
        }
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
            'Non Farm Payrolls',
            'Federal Funds Rate',
            'FOMC Meeting Minutes',
            'Fed Chair Speech'
        ];
        
        const highImpact = [
            'Consumer Price Index',
            'GDP',
            'Unemployment Rate',
            'ISM Manufacturing PMI'
        ];
        
        const eventName = event.Event?.toLowerCase() || '';
        
        if (veryHighImpact.some(indicator => eventName.includes(indicator.toLowerCase()))) {
            return 'very_high';
        } else if (highImpact.some(indicator => eventName.includes(indicator.toLowerCase()))) {
            return 'high';
        }
        
        return 'medium';
    }
}
