export default async function handler(req, res) {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            trading_enabled: process.env.TRADING_ENABLED === 'true',
            paper_trading: process.env.PAPER_TRADING === 'true'
        };
        
        res.status(200).json(health);
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
