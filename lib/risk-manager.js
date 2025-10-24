// lib/risk-manager.js

export class RiskManager {
  constructor() {
    this.maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS || '0.02'); // 2%
    this.maxPositionSize = parseFloat(process.env.MAX_POSITION_SIZE || '0.05'); // 5%
    this.riskPerTrade = parseFloat(process.env.RISK_PER_TRADE || '0.01'); // 1%
    this.minBuyingPower = 0.10; // Keep 10% buying power available
    this.maxOpenPositions = parseInt(process.env.MAX_OPEN_POSITIONS || '5');
    this.maxConsecutiveLosses = 3;
  }

  /**
   * Check if trading is allowed based on risk parameters
   */
  async checkPreTradeRisk(params) {
    const { account, positions, executionState } = params;
    
    try {
      // Check 1: Daily loss limit
      const dailyPnL = parseFloat(account.equity) - parseFloat(account.last_equity);
      const dailyLossPct = dailyPnL / parseFloat(account.last_equity);
      
      if (dailyLossPct < -this.maxDailyLoss) {
        return {
          canTrade: false,
          reason: `Daily loss limit exceeded: ${(dailyLossPct * 100).toFixed(2)}%`,
          dailyPnL: dailyPnL,
          dailyLossPct: dailyLossPct
        };
      }
      
      // Check 2: Max open positions
      if (positions.length >= this.maxOpenPositions) {
        return {
          canTrade: false,
          reason: `Maximum open positions reached: ${positions.length}/${this.maxOpenPositions}`
        };
      }
      
      // Check 3: Buying power
      const buyingPower = parseFloat(account.buying_power);
      const equity = parseFloat(account.equity);
      const buyingPowerPct = buyingPower / equity;
      
      if (buyingPowerPct < this.minBuyingPower) {
        return {
          canTrade: false,
          reason: `Insufficient buying power: ${(buyingPowerPct * 100).toFixed(2)}%`,
          buyingPower: buyingPower,
          buyingPowerPct: buyingPowerPct
        };
      }
      
      // Check 4: Account status
      if (account.account_blocked || account.trade_suspended_by_user) {
        return {
          canTrade: false,
          reason: 'Account is blocked or trading is suspended'
        };
      }
      
      // All checks passed
      return {
        canTrade: true,
        reason: 'All risk checks passed',
        availableCapital: buyingPower,
        equity: equity,
        dailyPnL: dailyPnL,
        openPositions: positions.length
      };
      
    } catch (error) {
      console.error('[RISK] Error in checkPreTradeRisk:', error);
      return {
        canTrade: false,
        reason: `Risk check error: ${error.message}`
      };
    }
  }

  /**
   * Calculate position size based on risk parameters
   */
  calculatePositionSize(params) {
    const { account, pattern, riskPerTrade } = params;
    
    try {
      const equity = parseFloat(account.equity);
      const riskAmount = equity * (riskPerTrade || this.riskPerTrade);
      
      // Calculate risk per share based on pattern stop loss
      const entryPrice = pattern.breakout_level;
      const stopLoss = pattern.pattern_type === 'bullish_flag' ? 
        pattern.flag_low : pattern.flag_high;
      
      const riskPerShare = Math.abs(entryPrice - stopLoss);
      
      if (riskPerShare === 0) {
        return {
          quantity: 0,
          error: 'Risk per share is zero'
        };
      }
      
      // Calculate quantity
      let quantity = Math.floor(riskAmount / riskPerShare);
      
      // Apply max position size limit
      const maxPositionValue = equity * this.maxPositionSize;
      const maxQuantity = Math.floor(maxPositionValue / entryPrice);
      
      quantity = Math.min(quantity, maxQuantity);
      
      // Ensure at least 1 if risk allows
      if (quantity < 1 && riskAmount >= entryPrice) {
        quantity = 1;
      }
      
      return {
        quantity: quantity,
        riskAmount: riskAmount,
        riskPerShare: riskPerShare,
        positionValue: quantity * entryPrice,
        positionSizePct: (quantity * entryPrice) / equity
      };
      
    } catch (error) {
      console.error('[RISK] Error calculating position size:', error);
      return {
        quantity: 0,
        error: error.message
      };
    }
  }

  /**
   * Validate trade parameters before execution
   */
  validateTrade(tradeParams) {
    const { quantity, price, stopLoss, takeProfit } = tradeParams;
    
    // Check quantity is positive
    if (!quantity || quantity <= 0) {
      return { valid: false, reason: 'Invalid quantity' };
    }
    
    // Check price is positive
    if (!price || price <= 0) {
      return { valid: false, reason: 'Invalid price' };
    }
    
    // Check stop loss and take profit are valid
    if (!stopLoss || stopLoss <= 0) {
      return { valid: false, reason: 'Invalid stop loss' };
    }
    
    if (!takeProfit || takeProfit <= 0) {
      return { valid: false, reason: 'Invalid take profit' };
    }
    
    // Check risk:reward ratio (minimum 1:1.5)
    const risk = Math.abs(price - stopLoss);
    const reward = Math.abs(takeProfit - price);
    const riskRewardRatio = reward / risk;
    
    if (riskRewardRatio < 1.5) {
      return {
        valid: false,
        reason: `Poor risk:reward ratio: 1:${riskRewardRatio.toFixed(2)}`,
        riskRewardRatio: riskRewardRatio
      };
    }
    
    return {
      valid: true,
      riskRewardRatio: riskRewardRatio,
      risk: risk,
      reward: reward
    };
  }

  /**
   * Calculate portfolio heat (total risk across all positions)
   */
  calculatePortfolioHeat(positions, account) {
    try {
      let totalRisk = 0;
      const equity = parseFloat(account.equity);
      
      for (const position of positions) {
        const positionValue = Math.abs(parseFloat(position.market_value));
        const currentPrice = parseFloat(position.current_price);
        
        // Estimate risk as 2% of position value (adjust based on actual stop loss)
        const estimatedRisk = positionValue * 0.02;
        totalRisk += estimatedRisk;
      }
      
      const portfolioHeatPct = totalRisk / equity;
      
      return {
        totalRisk: totalRisk,
        portfolioHeatPct: portfolioHeatPct,
        equity: equity,
        isExcessive: portfolioHeatPct > 0.06 // More than 6% total risk
      };
      
    } catch (error) {
      console.error('[RISK] Error calculating portfolio heat:', error);
      return {
        totalRisk: 0,
        portfolioHeatPct: 0,
        error: error.message
      };
    }
  }

  /**
   * Check if daily reset is needed
   */
  shouldResetDailyCounters(lastResetDate) {
    const today = new Date().toISOString().split('T')[0];
    return lastResetDate !== today;
  }

  /**
   * Calculate maximum allowed loss per trade
   */
  getMaxLossPerTrade(account) {
    const equity = parseFloat(account.equity);
    return equity * this.riskPerTrade;
  }

  /**
   * Check if position size is within limits
   */
  isPositionSizeValid(positionValue, account) {
    const equity = parseFloat(account.equity);
    const positionPct = positionValue / equity;
    return positionPct <= this.maxPositionSize;
  }

  /**
   * Calculate stop loss distance as percentage
   */
  calculateStopLossDistance(entryPrice, stopLoss) {
    return Math.abs(entryPrice - stopLoss) / entryPrice;
  }

  /**
   * Validate risk:reward meets minimum requirement
   */
  validateRiskReward(entryPrice, stopLoss, takeProfit, minRatio = 1.5) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const ratio = reward / risk;
    
    return {
      valid: ratio >= minRatio,
      ratio: ratio,
      risk: risk,
      reward: reward
    };
  }
}
