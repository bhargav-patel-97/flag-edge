import { createClient } from '@supabase/supabase-js';

export class SupabaseClient {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY
        );
    }

    async logExecution(result) {
        const { data, error } = await this.supabase
            .from('strategy_executions')
            .insert([{
                timestamp: new Date().toISOString(),
                symbol: result.symbol,
                timeframe: result.timeframe,
                signals_generated: result.signals?.length || 0,
                trades_executed: result.trades?.length || 0,
                result: result
            }]);

        if (error) throw error;
        return data;
    }

    async logTrade(trade) {
        const { data, error } = await this.supabase
            .from('trades')
            .insert([{
                timestamp: new Date().toISOString(),
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                option_contract: trade.optionContract,
                strategy: 'level_flag',
                entry_reason: trade.entryReason,
                exit_reason: trade.exitReason,
                pnl: trade.pnl,
                status: trade.status
            }]);

        if (error) throw error;
        return data;
    }

    async logError(error) {
        const { data, errorDb } = await this.supabase
            .from('error_logs')
            .insert([{
                timestamp: new Date().toISOString(),
                message: error.message,
                stack: error.stack,
                function_name: error.functionName || 'unknown'
            }]);

        if (errorDb) console.error('Failed to log error to database:', errorDb);
        return data;
    }

    async logEvent(event, data = {}) {
        const { data: result, error } = await this.supabase
            .from('system_events')
            .insert([{
                timestamp: new Date().toISOString(),
                event_type: event,
                data: data
            }]);

        if (error) throw error;
        return result;
    }

    async getTodaysPnL() {
        const today = new Date().toISOString().split('T')[0];
        
        const { data, error } = await this.supabase
            .from('trades')
            .select('pnl')
            .gte('timestamp', `${today}T00:00:00.000Z`)
            .lt('timestamp', `${today}T23:59:59.999Z`)
            .not('pnl', 'is', null);

        if (error) throw error;
        
        return data.reduce((total, trade) => total + (trade.pnl || 0), 0);
    }

    async getRecentTrades(limit = 10) {
        const { data, error } = await this.supabase
            .from('trades')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    }

    async getAccountMetrics() {
        // Get metrics for the last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data, error } = await this.supabase
            .from('trades')
            .select('pnl, timestamp')
            .gte('timestamp', thirtyDaysAgo.toISOString())
            .not('pnl', 'is', null);

        if (error) throw error;

        const totalPnL = data.reduce((sum, trade) => sum + trade.pnl, 0);
        const winningTrades = data.filter(trade => trade.pnl > 0).length;
        const totalTrades = data.length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

        return {
            totalPnL,
            totalTrades,
            winRate,
            avgTradeReturn: totalTrades > 0 ? totalPnL / totalTrades : 0
        };
    }
}
