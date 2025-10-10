import { SupabaseClient } from '../lib/supabase-client.js';

export default async function handler(req, res) {
    try {
        const { limit = 50, offset = 0, symbol, start_date, end_date } = req.query;
        
        const db = new SupabaseClient();
        
        let query = db.supabase
            .from('trades')
            .select('*')
            .order('timestamp', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
        
        if (symbol) {
            query = query.eq('symbol', symbol);
        }
        
        if (start_date) {
            query = query.gte('timestamp', start_date);
        }
        
        if (end_date) {
            query = query.lte('timestamp', end_date);
        }
        
        const { data: trades, error } = await query;
        
        if (error) {
            throw error;
        }
        
        // Calculate summary statistics
        const totalTrades = trades.length;
        const profitableTrades = trades.filter(trade => (trade.pnl || 0) > 0).length;
        const totalPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
        const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
        const avgTrade = totalTrades > 0 ? totalPnL / totalTrades : 0;
        
        res.status(200).json({
            trades,
            summary: {
                totalTrades,
                profitableTrades,
                totalPnL: parseFloat(totalPnL.toFixed(2)),
                winRate: parseFloat(winRate.toFixed(2)),
                avgTrade: parseFloat(avgTrade.toFixed(2))
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Trade history error:', error);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
