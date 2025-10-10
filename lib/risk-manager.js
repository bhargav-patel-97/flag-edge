import { SupabaseClient } from './supabase-client.js';
import { AlpacaClient } from './alpaca-client.js';

export class RiskManager {
    constructor() {
        this.db = new SupabaseClient();
        this.alpaca = new AlpacaClient();
        this.maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS || '0.02');
        this.maxPositionSize = parseFloat(process.env.MAX_POSITION_SIZE || '0.05');
        this.riskPerTrade = parseFloat(process.env.RISK_PER_TRADE || '0.01');
        this.maxOpenPositions = 5;
    }

    async shouldPauseTrading() {
        try {
            // Check daily loss limit
            const dailyPnL = await this.db.getTodaysPnL();
            const account = await this.alpaca.getAccount();
            const accountValue = parseFloat(account.equity);
            const dailyLossPercent = Math.abs(dailyPnL) / accountValue;

            if (dailyLossPercent >= this.maxDailyLoss) {
                return {
                    pause: true,
                    reason: 'daily_loss_limit_reached',
                    currentLoss: dailyLossPercent,
                    maxLoss: this.maxDailyLoss
                };
            }

            // Check number of open positions
            const positions = await this.alpaca.getPositions();
            if (positions.length >= this.maxOpenPositions) {
                return {
                    pause: true,
                    reason: 'max_positions_reached',
                    currentPositions: positions.length,
                    maxPositions: this.maxOpenPositions
                };
            }

            // Check account buying power
            const buyingPower = parseFloat(account.buying_power);
            const minBuyingPower = accountValue * 0.1; // Keep 10% buying power
            
            if (buyingPower < minBuyingPower) {
                return {
                    pause: true,
                    reason: 'insufficient_buying_power',
                    currentBuyingPower: buyingPower,
                    minRequired: minBuyingPower
                };
            }

            // Check recent consecutive losses
            const recentTrades = await this.db.getRecentTrades(5);
            const consecutiveLosses = this.countConsecutiveLosses(recentTrades);
            
            if (consecutiveLosses >= 3) {
                return {
                    pause: true,
                    reason: 'consecutive_losses',
                    consecutiveLosses: consecutiveLosses
                };
            }

            return { pause: false };

        } catch (error) {
            console.error('Risk check error:', error);
            return {
                pause: true,
                reason: 'risk_check_error',
                error: error.message
            };
        }
    }

    calculatePositionSize(accountValue, entryPrice, stopLoss) {
        // Calculate position size based on risk per trade
        const riskAmount = accountValue * this.riskPerTrade;
        const riskPerShare = Math.abs(entryPrice - stopLoss);
        
        if (riskPerShare === 0) {
            return 0;
        }

        const sharesBasedOnRisk = Math.floor(riskAmount / (riskPerShare * 100)); // Options are 100 shares per contract
        const maxShares = Math.floor((accountValue * this.maxPositionSize) / (entryPrice * 100));
        
        return Math.min(sharesBasedOnRisk, maxShares, 10); // Max 10 contracts
    }

    countConsecutiveLosses(trades) {
        let consecutiveLosses = 0;
        
        for (const trade of trades) {
            if (trade.pnl < 0) {
                consecutiveLosses++;
            } else {
                break;
            }
        }
        
        return consecutiveLosses;
    }

    async calculateRiskMetrics() {
        try {
            const account = await this.alpaca.getAccount();
            const positions = await this.alpaca.getPositions();
            const accountValue = parseFloat(account.equity);
            
            // Portfolio risk metrics
            const totalPositionValue = positions.reduce((sum, pos) => 
                sum + Math.abs(parseFloat(pos.market_value)), 0
            );
            
            const portfolioConcentration = totalPositionValue / accountValue;
            
            // Options-specific risk
            const optionPositions = positions.filter(pos => pos.asset_class === 'us_option');
            const totalOptionsValue = optionPositions.reduce((sum, pos) => 
                sum + Math.abs(parseFloat(pos.market_value)), 0
            );
            
            const optionsExposure = totalOptionsValue / accountValue;
            
            // Time decay risk (theta)
            const totalTheta = optionPositions.reduce((sum, pos) => {
                // This would require getting current option quotes for theta
                return sum; // Placeholder
            }, 0);
            
            // Daily P&L metrics
            const dailyPnL = await this.db.getTodaysPnL();
            const monthlyMetrics = await this.db.getAccountMetrics();
            
            return {
                accountValue,
                portfolioConcentration,
                optionsExposure,
                totalTheta,
                dailyPnL,
                dailyPnLPercent: (dailyPnL / accountValue) * 100,
                remainingDailyRisk: (this.maxDailyLoss * accountValue) - Math.abs(dailyPnL),
                monthlyMetrics,
                openPositions: positions.length,
                maxPositions: this.maxOpenPositions,
                riskUtilization: {
                    daily: Math.abs(dailyPnL) / (this.maxDailyLoss * accountValue),
                    position: portfolioConcentration / this.maxPositionSize,
                    overall: Math.min(
                        Math.abs(dailyPnL) / (this.maxDailyLoss * accountValue),
                        portfolioConcentration / this.maxPositionSize
                    )
                }
            };
        } catch (error) {
            console.error('Risk metrics calculation error:', error);
            throw error;
        }
    }

    validateTrade(trade, accountMetrics) {
        const validationErrors = [];
        const warnings = [];
        
        // Check if trade fits within risk parameters
        const tradeValue = trade.price * trade.quantity * 100;
        const positionPercent = tradeValue / accountMetrics.accountValue;
        
        if (positionPercent > this.maxPositionSize) {
            validationErrors.push(`Position size ${(positionPercent * 100).toFixed(2)}% exceeds maximum ${(this.maxPositionSize * 100)}%`);
        }
        
        // Check correlation with existing positions
        if (accountMetrics.optionsExposure > 0.3) {
            warnings.push('High options exposure detected');
        }
        
        // Check if adding to concentrated position
        if (accountMetrics.portfolioConcentration > 0.7) {
            warnings.push('Portfolio concentration is high');
        }
        
        return {
            valid: validationErrors.length === 0,
            errors: validationErrors,
            warnings: warnings
        };
    }
}
