import { AlpacaClient } from '../lib/alpaca-client.js';
import { IndicatorCalculator } from '../lib/indicators.js';

export default async function handler(req, res) {
    try {
        const { symbol = 'QQQ', timeframe = '5Min', limit = 100 } = req.query;
        
        const alpaca = new AlpacaClient();
        const calculator = new IndicatorCalculator();

        // Get market data
        const bars = await alpaca.getBars({
            symbols: [symbol],
            timeframe,
            limit: parseInt(limit)
        });

        if (!bars || bars.length === 0) {
            return res.status(404).json({ error: 'No market data available' });
        }

        // Calculate indicators
        const closes = bars.map(bar => bar.close);
        const ma200 = calculator.sma(closes, 200);
        const ma400 = calculator.sma(closes, 400);
        
        // Detect support/resistance levels
        const levels = calculator.detectLevels(bars, { ma200, ma400 });

        res.status(200).json({
            symbol,
            timeframe,
            bars: bars.slice(-20), // Return last 20 bars
            indicators: {
                ma200: ma200[ma200.length - 1],
                ma400: ma400[ma400.length - 1]
            },
            levels,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Market data error:', error);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
