import { AlpacaClient } from "./alpaca-client.js";
import { SupabaseClient } from "./supabase-client.js";
import { IndicatorCalculator } from "./indicators.js";
import { LevelDetector } from "./level-detector.js";
import { FlagDetector } from "./flag-detector.js";
import { OptionSelector } from "./option-selector.js";
import { RiskManager } from "./risk-manager.js";
import { EconomicCalendar } from "./economic-calendar.js";

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
    const easternTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);

    const hour = parseInt(
      easternTime.find((part) => part.type === "hour").value
    );
    const minute = parseInt(
      easternTime.find((part) => part.type === "minute").value
    );
    const currentTime = hour * 60 + minute; // Convert to minutes since midnight

    const marketOpen = 9 * 60 + 30; // 9:30 AM
    const marketClose = 16 * 60; // 4:00 PM
    const firstSession = 10 * 60; // 10:00 AM
    const secondSession = 11 * 60; // 11:00 AM

    // Check if market is open (Monday-Friday)
    const dayOfWeek = now.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isDuringMarketHours =
      currentTime >= marketOpen && currentTime < marketClose;

    if (!isWeekday || !isDuringMarketHours) {
      return { isOpen: false, timeframe: null };
    }

    // Determine timeframe based on time
    let timeframe;
    if (currentTime < firstSession) {
      timeframe = "2Min"; // 9:30-10:00 AM
    } else if (currentTime < secondSession) {
      timeframe = "5Min"; // 10:00-11:00 AM
    } else {
      timeframe = "10Min"; // 11:00 AM-4:00 PM
    }

    return {
      isOpen: true,
      timeframe,
      session:
        currentTime < firstSession
          ? "opening"
          : currentTime < secondSession
          ? "morning"
          : "regular",
    };
  }

  async checkEconomicEvents() {
    try {
      const events = await this.economicCalendar.getTodaysEvents();
      const highImpactEvents = events.filter(
        (event) => event.importance === "High" && this.isEventNearby(event.time)
      );

      return highImpactEvents.length > 0;
    } catch (error) {
      console.error("Error checking economic events:", error);
      return false; // Don't pause trading if we can't check events
    }
  }

  isEventNearby(eventTime, bufferMinutes = 30) {
    const now = new Date();
    const event = new Date(eventTime);
    const timeDiff = Math.abs(now - event) / (1000 * 60); // Minutes
    return timeDiff <= bufferMinutes;
  }

  async execute({ symbol = "QQQ", timeframe = "5Min", maxPositions = 3 }) {
    try {
      console.log(
        `Starting strategy execution for ${symbol} on ${timeframe} timeframe`
      );

      // Check if we should pause for risk management
      const shouldPause = await this.riskManager.shouldPauseTrading();
      if (shouldPause.pause) {
        console.log(
          "Trading paused due to risk management:",
          shouldPause.reason
        );
        return {
          success: false,
          reason: shouldPause.reason,
          symbol,
          timeframe,
        };
      }

      // Get market data with better error handling
      console.log(`Fetching market data for ${symbol}...`);
      let bars;
      try {
        bars = await this.alpaca.getBarsFromDatabase(symbol, timeframe, 500);
      } catch (apiError) {
        console.error("Alpaca API error:", apiError);
        throw new Error(`Failed to fetch market data: ${apiError.message}`);
      }

      // Enhanced data validation with more flexible requirements
      if (!bars || !Array.isArray(bars) || bars.length === 0) {
        console.warn("No market data received from Alpaca API");
        return {
          success: false,
          reason: "No market data available",
          symbol,
          timeframe,
          dataReceived: bars ? bars.length : 0,
        };
      }

      console.log(`Received ${bars.length} bars from Alpaca API`);

      // More flexible data requirements - adjust based on what we actually need
      const minBarsForMA200 = 200;
      const minBarsForMA400 = 400;
      const minBarsForStrategy = 50; // Minimum bars needed for basic strategy

      if (bars.length < minBarsForStrategy) {
        console.warn(
          `Insufficient data for strategy: ${bars.length} bars (minimum ${minBarsForStrategy} required)`
        );
        return {
          success: false,
          reason: `Insufficient data: ${bars.length} bars (minimum ${minBarsForStrategy} required)`,
          symbol,
          timeframe,
          dataReceived: bars.length,
        };
      }

      // Calculate indicators with available data
      const closes = bars.map((bar) => bar.close);
      const highs = bars.map((bar) => bar.high);
      const lows = bars.map((bar) => bar.low);
      const volumes = bars.map((bar) => bar.volume);

      console.log("Calculating technical indicators...");

      // Calculate MAs only if we have enough data, otherwise use shorter periods
      let ma200 = null;
      let ma400 = null;

      if (bars.length >= minBarsForMA200) {
        ma200 = this.indicators.sma(closes, 200);
        console.log("Calculated 200 MA");
      } else {
        // Use shorter MA as fallback
        const fallbackPeriod = Math.min(50, Math.floor(bars.length * 0.5));
        if (fallbackPeriod >= 10) {
          ma200 = this.indicators.sma(closes, fallbackPeriod);
          console.log(
            `Calculated fallback MA${fallbackPeriod} instead of 200 MA`
          );
        }
      }

      if (bars.length >= minBarsForMA400) {
        ma400 = this.indicators.sma(closes, 400);
        console.log("Calculated 400 MA");
      } else {
        // Use shorter MA as fallback
        const fallbackPeriod = Math.min(100, Math.floor(bars.length * 0.75));
        if (fallbackPeriod >= 20) {
          ma400 = this.indicators.sma(closes, fallbackPeriod);
          console.log(
            `Calculated fallback MA${fallbackPeriod} instead of 400 MA`
          );
        }
      }

      // Detect levels with available indicators
      console.log("Detecting support/resistance levels...");
      const levels = this.levelDetector.detectLevels(bars, { ma200, ma400 });
      console.log(`Detected ${levels.length} key levels`);

      // Detect flag patterns using recent bars
      console.log("Analyzing flag patterns...");
      const analysisWindow = Math.min(50, bars.length);
      const flagPattern = this.flagDetector.detectFlag(
        bars.slice(-analysisWindow),
        levels
      );

      let signals = [];
      let trades = [];

      if (flagPattern && flagPattern.confluence > 1) {
        // Lowered threshold for testing
        console.log(
          "Flag pattern detected with confluence:",
          flagPattern.confluence
        );

        // Generate trade signal
        const signal = {
          symbol,
          pattern: flagPattern,
          direction: flagPattern.direction,
          entry: flagPattern.breakoutLevel,
          confidence: flagPattern.confluence,
          timestamp: new Date().toISOString(),
        };

        signals.push(signal);

        // Check current positions
        try {
          const positions = await this.alpaca.getPositions();
          const currentPositions = positions.filter((pos) =>
            pos.symbol.startsWith(symbol)
          );
          console.log(
            `Current positions for ${symbol}: ${currentPositions.length}`
          );

          if (currentPositions.length < maxPositions) {
            console.log("Attempting to execute trade...");
            // Execute trade
            const trade = await this.executeTrade(signal);
            if (trade) {
              trades.push(trade);
              await this.db.logTrade(trade);
              console.log("Trade executed and logged successfully");
            } else {
              console.log("Trade execution failed or no suitable option found");
            }
          } else {
            console.log(`Maximum positions (${maxPositions}) reached`);
          }
        } catch (positionError) {
          console.error("Error checking positions:", positionError);
          // Continue without executing trades
        }
      } else {
        console.log(
          "No valid flag pattern detected or insufficient confluence"
        );
      }

      const result = {
        success: true,
        symbol,
        timeframe,
        dataReceived: bars.length,
        indicatorsUsed: {
          ma200: ma200 ? ma200.length : 0,
          ma400: ma400 ? ma400.length : 0,
        },
        levels: levels.length,
        flagPattern: flagPattern
          ? {
              direction: flagPattern.direction,
              confluence: flagPattern.confluence,
              validity: flagPattern.validity?.rating,
            }
          : null,
        signals: signals.length,
        trades: trades.length,
        timestamp: new Date().toISOString(),
      };

      console.log("Strategy execution completed successfully:", result);
      return result;
    } catch (error) {
      console.error("Strategy execution error:", error);
      await this.db.logError({
        ...error,
        functionName: "LevelFlagStrategy.execute",
        symbol,
        timeframe,
      });
      throw error;
    }
  }

  async executeTrade(signal) {
    try {
      console.log(
        "Starting trade execution for signal:",
        signal.symbol,
        signal.direction
      );

      // Get account information
      const account = await this.alpaca.getAccount();
      const accountValue = parseFloat(account.equity);
      console.log(`Account value: $${accountValue}`);

      // Calculate position size
      const riskAmount =
        accountValue * parseFloat(process.env.RISK_PER_TRADE || "0.01");
      console.log(`Risk amount per trade: $${riskAmount}`);

      // Get option chain
      let optionChain;
      try {
        optionChain = await this.alpaca.getOptionChain(signal.symbol);
      } catch (optionError) {
        console.error("Failed to get option chain:", optionError);
        return null;
      }

      // Select optimal option
      const selectedOption = this.optionSelector.selectOption(
        optionChain,
        signal.direction,
        riskAmount
      );

      if (!selectedOption) {
        console.log("No suitable option found for signal");
        return null;
      }

      console.log("Selected option:", {
        symbol: selectedOption.symbol,
        strike: selectedOption.strike,
        expiration: selectedOption.expiration,
        price: selectedOption.price,
      });

      // Calculate stop loss and take profit
      const stopLoss = this.calculateStopLoss(signal, selectedOption);
      const takeProfit = this.calculateTakeProfit(signal, selectedOption);

      // Submit order
      const orderData = {
        symbol: selectedOption.symbol,
        qty: selectedOption.quantity,
        side: signal.direction === "bullish" ? "buy" : "sell",
        type: "market",
        time_in_force: "day",
        order_class: "bracket",
        stop_loss: {
          stop_price: stopLoss.toString(),
        },
        take_profit: {
          limit_price: takeProfit.toString(),
        },
      };

      const order = await this.alpaca.submitOrder(orderData);
      console.log("Order submitted successfully:", order.id);

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
        status: "submitted",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Trade execution error:", error);
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
    return option.price + risk * 2;
  }

  async executeTimeframedStrategy(timeframe, force = false) {
    console.log(`Executing timeframed strategy: ${timeframe}, force: ${force}`);

    const marketSession = this.getMarketSession();
    console.log("Market session status:", marketSession);

    if (
      !force &&
      (!marketSession.isOpen || marketSession.timeframe !== timeframe)
    ) {
      console.log("Strategy execution skipped - outside designated timeframe");
      return {
        success: false,
        reason: "Outside designated timeframe",
        expected: marketSession.timeframe,
        requested: timeframe,
        marketOpen: marketSession.isOpen,
        currentSession: marketSession.session,
      };
    }

    console.log("Proceeding with strategy execution...");
    return this.execute({
      symbol: "QQQ",
      timeframe,
      maxPositions: 3,
    });
  }
}
