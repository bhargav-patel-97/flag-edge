import { LevelFlagStrategy } from '../../lib/level-flag-strategy.js';
import { verifyWebhookSignature } from '../../lib/security.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify FastCron webhook signature
        if (!verifyWebhookSignature(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { timeframe, force = false } = req.body;
        
        const strategy = new LevelFlagStrategy();
        
        // Execute strategy based on current timeframe
        const result = await strategy.executeTimeframedStrategy(timeframe, force);

        res.status(200).json({
            success: true,
            message: 'Strategy executed successfully',
            result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Webhook execution error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
