import { LevelFlagStrategy } from '../lib/level-flag-strategy.js';
import { AlpacaClient } from '../lib/alpaca-client.js';
import { SupabaseClient } from '../lib/supabase-client.js';
import { verifyWebhookSignature } from '../lib/security.js';

export default async function handler(req, res) {
    try {
        // Verify FastCron webhook signature
        if (!verifyWebhookSignature(req)) {
            return res.status(401).json({ error: 'Unauthorized webhook' });
        }

        const strategy = new LevelFlagStrategy();
        const alpaca = new AlpacaClient();
        const db = new SupabaseClient();

        // Check if trading is enabled
        if (process.env.TRADING_ENABLED !== 'true') {
            return res.status(200).json({ message: 'Trading disabled' });
        }

        // Check market hours and determine timeframe
        const marketSession = strategy.getMarketSession();
        if (!marketSession.isOpen) {
            return res.status(200).json({ message: 'Market closed' });
        }

        // Check for economic events
        const hasHighImpactEvents = await strategy.checkEconomicEvents();
        if (hasHighImpactEvents) {
            await db.logEvent('trading_paused', { reason: 'high_impact_economic_event' });
            return res.status(200).json({ message: 'Trading paused due to economic events' });
        }

        // Execute main strategy
        const result = await strategy.execute({
            symbol: 'QQQ',
            timeframe: marketSession.timeframe,
            maxPositions: 3
        });

        // Log execution to database
        await db.logExecution(result);

        res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            result: result
        });

    } catch (error) {
        console.error('Strategy execution error:', error);
        
        // Log error to database
        await db.logError(error);
        
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}