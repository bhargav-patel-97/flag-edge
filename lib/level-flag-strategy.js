import { AlpacaClient } from './alpaca-client.js';
import { SupabaseClient } from './supabase-client.js';
import { IndicatorCalculator } from './indicators.js';
import { LevelDetector } from './level-detector.js';
import { FlagDetector } from './flag-detector.js';
import { OptionSelector } from './option-selector.js';
import { RiskManager } from './risk-manager.js';
import { EconomicCalendar } from './economic-calendar.js';

export class LevelFlagStrategy {
    constructor() {
        this.alpaca = new AlpacaClient();
        this.db = new SupabaseClient();
        this.indicators = new IndicatorCalculator();
        this.levelDetector = new LevelDetector();
        this.flagDetector = new FlagDetector();
        this.optionSelector = new OptionSelector();
        this.riskManager = new RiskManager();
        this.economicCalendar = new EconomicCalendar();
    }

    getMarketSession() {
        const now = new Date();
        const easternTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        }).formatToParts(now);

        const hour = parseInt(easternTime.find(part => part.type === 'hour').value);
        const minute = parseInt(easternTime.find(part => part.type === 'minute').value);
        const currentTime = hour * 60 + minute; // Convert to minutes since midnight

        const marketOpen = 9 * 60 + 30; // 9:30 AM
        const marketClose = 16 * 60; // 4:00 PM
        const firstSession = 10 * 60; // 10:00 AM
        const secondSession = 11 * 60; // 11:00 AM

        // Check if market is open (Monday-Friday)
        const dayOfWeek = now.getDay();
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
        const isDuringMarketHours = currentTime >= marketOpen && currentTime < marketClose;

        if (!isWeekday || !isDuringMarketHours) {
            return { isOpen: false, timeframe: null };
        }

        // Determine timeframe based on time
        let timeframe;
        if (currentTime < firstSession) {
            timeframe = '2Min'; // 9:30-10:00 AM
        } else if (currentTime < secondSession) {
            timeframe = '5Min'; // 10:00-11:00 AM
        } else {
            timeframe = '10Min'; // 11:00 AM-4:00 PM
        }

        return {
            isOpen: true,
            timeframe,
            session: currentTime < firstSession ? 'opening' : 
                    currentTime < secondSession ? 'morning' : 'regular'
        };
    }

    async checkEconomicEvents() {
        try {
            const events = await this.economicCalendar.getTodaysEvents();
            const highImpactEvents = events.filter(event => 
                event.importance === 'High' && 
                this.isEventNearby(event.time)
            );

            return highImpactEvents.length > 0;
        } catch (error) {
            console.error('Error checking economic events:', error);
            return false; // Don't pause trading if we can't check events
        }
    }

    isEventNearby(eventTime, bufferMinutes = 30) {
        const now = new Date();
        const event = new Date(eventTime);
        const timeDiff = Math.abs(now - event) / (1000 * 60); // Minutes
        return timeDiff <= bufferMinutes;
    }

    async execute({ symbol = 'QQQ', timeframe = '5Min', maxPositions = 3 }) {
        try {
            // Check if we should pause for risk management
            const shouldPause = await this.riskManager.shouldPauseTrading();
            if (shouldPause.pause) {
                return {
                    success: false,
                    reason: shouldPause.reason,
                    symbol,
                    timeframe
                };
            }

            // Get market data
            const bars = await this.alpaca.getBars({
                symbols: [symbol],
                timeframe,
                limit: 500
            });

            if (!bars || bars.length < 400) {
                throw new Error('Insufficient historical data');
            }

            // Calculate indicators
            const closes = bars.map(bar => bar.close);
            const highs = bars.map(bar => bar.high);
            const lows = bars.map(bar => bar.low);
            const volumes = bars.map(bar => bar.volume);

            const ma200 = this.indicators.sma(closes, 200);
            const ma400 = this.indicators.sma(closes, 400);

            // Detect levels
            const levels = this.levelDetector.detectLevels(bars, { ma200, ma400 });

            // Detect flag patterns
            const flagPattern = this.flagDetector.detectFlag(bars.slice(-50), levels);

            let signals = [];
            let trades = [];

            if (flagPattern && flagPattern.confluence > 2) {
                // Generate trade signal
                const signal = {
                    symbol,
                    pattern: flagPattern,
                    direction: flagPattern.direction,
                    entry: flagPattern.breakoutLevel,
                    confidence: flagPattern.confluence,
                    timestamp: new Date().toISOString()
                };

                signals.push(signal);

                // Check current positions
                const positions = await this.alpaca.getPositions();
                const currentPositions = positions.filter(pos => pos.symbol.startsWith(symbol));

                if (currentPositions.length < maxPositions) {
                    // Execute trade
                    const trade = await this.executeTrade(signal);
                    if (trade) {
                        trades.push(trade);
                        await this.db.logTrade(trade);
                    }
                }
            }

            return {
                success: true,
                symbol,
                timeframe,
                levels,
                flagPattern,
                signals,
                trades,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Strategy execution error:', error);
            await this.db.logError({
                ...error,
                functionName: 'LevelFlagStrategy.execute'
            });
            throw error;
        }
    }

    async executeTrade(signal) {
        try {
            // Get account information
            const account = await this.alpaca.getAccount();
            const accountValue = parseFloat(account.equity);

            // Calculate position size
            const riskAmount = accountValue * parseFloat(process.env.RISK_PER_TRADE || '0.01');
            
            // Get option chain
            const optionChain = await this.alpaca.getOptionChain(signal.symbol);
            
            // Select optimal option
            const selectedOption = this.optionSelector.selectOption(
                optionChain,
                signal.direction,
                riskAmount
            );

            if (!selectedOption) {
                console.log('No suitable option found for signal');
                return null;
            }

            // Calculate stop loss and take profit
            const stopLoss = this.calculateStopLoss(signal, selectedOption);
            const takeProfit = this.calculateTakeProfit(signal, selectedOption);

            // Submit order
            const orderData = {
                symbol: selectedOption.symbol,
                qty: selectedOption.quantity,
                side: signal.direction === 'bullish' ? 'buy' : 'sell',
                type: 'market',
                time_in_force: 'day',
                order_class: 'bracket',
                stop_loss: {
                    stop_price: stopLoss.toString()
                },
                take_profit: {
                    limit_price: takeProfit.toString()
                }
            };

            const order = await this.alpaca.submitOrder(orderData);

            return {
                symbol: signal.symbol,
                optionContract: selectedOption.symbol,
                side: orderData.side,
                quantity: selectedOption.quantity,
                price: selectedOption.price,
                stopLoss,
                takeProfit,
                entryReason: `Level flag ${signal.direction} breakout`,
                orderId: order.id,
                status: 'submitted',
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Trade execution error:', error);
            return null;
        }
    }

    calculateStopLoss(signal, option) {
        // Use 2% stop loss or key level, whichever is closer
        const percentStopLoss = option.price * 0.98;
        return Math.max(percentStopLoss, option.price * 0.95);
    }

    calculateTakeProfit(signal, option) {
        // Target 2:1 risk-reward ratio
        const risk = option.price * 0.02;
        return option.price + (risk * 2);
    }

    async executeTimeframedStrategy(timeframe, force = false) {
        const marketSession = this.getMarketSession();
        
        if (!force && (!marketSession.isOpen || marketSession.timeframe !== timeframe)) {
            return {
                success: false,
                reason: 'Outside designated timeframe',
                expected: marketSession.timeframe,
                requested: timeframe
            };
        }

        return this.execute({
            symbol: 'QQQ',
            timeframe,
            maxPositions: 3
        });
    }
}
