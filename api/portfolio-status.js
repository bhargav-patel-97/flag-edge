import { AlpacaClient } from '../lib/alpaca-client.js';
import { SupabaseClient } from '../lib/supabase-client.js';

export default async function handler(req, res) {
    try {
        const alpaca = new AlpacaClient();
        const db = new SupabaseClient();

        // Get account information
        const account = await alpaca.getAccount();
        const positions = await alpaca.getPositions();
        const orders = await alpaca.getOrders({ status: 'open' });

        // Get today's P&L from database
        const todaysPnL = await db.getTodaysPnL();
        const tradeHistory = await db.getRecentTrades(10);

        const portfolio = {
            account: {
                equity: parseFloat(account.equity),
                cash: parseFloat(account.cash),
                dayTradeCount: account.day_trade_count,
                buyingPower: parseFloat(account.buying_power)
            },
            positions: positions.map(pos => ({
                symbol: pos.symbol,
                qty: parseInt(pos.qty),
                market_value: parseFloat(pos.market_value),
                unrealized_pl: parseFloat(pos.unrealized_pl),
                unrealized_plpc: parseFloat(pos.unrealized_plpc)
            })),
            openOrders: orders.length,
            todaysPnL,
            recentTrades: tradeHistory,
            riskMetrics: {
                maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) * parseFloat(account.equity),
                currentDayLoss: todaysPnL < 0 ? Math.abs(todaysPnL) : 0,
                remainingRisk: Math.max(0, (parseFloat(process.env.MAX_DAILY_LOSS) * parseFloat(account.equity)) - Math.abs(todaysPnL))
            }
        };

        res.status(200).json({
            portfolio,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Portfolio status error:', error);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
