import { LevelFlagStrategy } from '../../lib/level-flag-strategy.js';
import { verifyWebhookSignature } from '../../lib/security.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Enhanced debugging - log request details
        console.log('Webhook received:', {
            method: req.method,
            headers: {
                'content-type': req.headers['content-type'],
                'x-fastcron-signature': req.headers['x-fastcron-signature'],
                'x-signature': req.headers['x-signature'],
                'signature': req.headers['signature'],
                'user-agent': req.headers['user-agent']
            },
            body: req.body,
            bodyType: typeof req.body
        });

        // Verify FastCron webhook signature
        const isValidSignature = verifyWebhookSignature(req);
        if (!isValidSignature) {
            console.warn('Invalid webhook signature - request rejected');
            return res.status(401).json({ 
                error: 'Unauthorized - Invalid signature',
                timestamp: new Date().toISOString()
            });
        }

        console.log('Webhook signature verified successfully');

        // Extract parameters from request body
        const { timeframe, force = false } = req.body || {};
        
        if (!timeframe) {
            console.warn('Missing timeframe parameter in request');
            return res.status(400).json({ 
                error: 'Missing timeframe parameter',
                expected: 'timeframe should be one of: 2Min, 5Min, 10Min',
                received: req.body
            });
        }

        // Validate timeframe
        const validTimeframes = ['2Min', '5Min', '10Min'];
        if (!validTimeframes.includes(timeframe)) {
            console.warn(`Invalid timeframe: ${timeframe}`);
            return res.status(400).json({ 
                error: 'Invalid timeframe',
                expected: validTimeframes,
                received: timeframe
            });
        }

        console.log(`Executing strategy for timeframe: ${timeframe}, force: ${force}`);
        
        const strategy = new LevelFlagStrategy();
        
        // Execute strategy based on current timeframe
        const result = await strategy.executeTimeframedStrategy(timeframe, force);

        console.log('Strategy execution completed:', {
            success: result.success,
            reason: result.reason,
            tradesExecuted: result.trades?.length || 0,
            signalsGenerated: result.signals?.length || 0
        });

        res.status(200).json({
            success: true,
            message: 'Strategy executed successfully',
            result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Webhook execution error:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            errorType: error.name,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}
