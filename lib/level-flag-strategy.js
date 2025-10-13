
import { AlpacaClient } from "./alpaca-client.js";
import { SupabaseClient } from "./supabase-client.js";
import { IndicatorCalculator } from "./indicators.js";
import { LevelDetector } from "./level-detector.js";
import { FlagDetector } from "./flag-detector.js";
import { OptionSelector } from "./option-selector.js";
import { RiskManager } from "./risk-manager.js";
import { EconomicCalendar } from "./economic-calendar.js";
import { PolygonClient } from "./polygon-client.js";

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
    this.polygonClient = new PolygonClient();
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
    const marketClose = 16 * 60 + 30; // 4:30 PM (market closes at 4:00 but we extend to 4:30 for our strategy)
    const firstSession = 10 * 60; // 10:00 AM
    const secondSession = 11 * 60; // 11:00 AM

    // Check if market is open (Monday-Friday)
    const dayOfWeek = now.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isDuringMarketHours =
      currentTime >= marketOpen && currentTime < marketClose;

    if (!isWeekday || !isDuringMarketHours) {
      return {
        isOpen: false,
        timeframe: null,
        currentTime: `${hour}:${minute.toString().padStart(2, '0')}`,
        dayOfWeek,
        marketOpen: "09:30",
        marketClose: "16:30"
      };
    }

    // Determine timeframe based on time
    let timeframe, session;
    if (currentTime < firstSession) {
      timeframe = "2Min"; // 9:30-10:00 AM
      session = "opening";
    } else if (currentTime < secondSession) {
      timeframe = "5Min"; // 10:00-11:00 AM
      session = "morning";
    } else {
      timeframe = "10Min"; // 11:00 AM-4:30 PM
      session = "regular";
    }

    return {
      isOpen: true,
      timeframe,
      session,
      currentTime: `${hour}:${minute.toString().padStart(2, '0')}`,
      dayOfWeek,
      marketOpen: "09:30",
      marketClose: "16:30"
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

  /**
   * Enhanced strategy execution with Polygon.io SMA integration
   */
  async execute({ symbol = "QQQ", timeframe = "5Min", maxPositions = 3 }) {
    try {
      console.log(
        `Starting enhanced strategy execution for ${symbol} on ${timeframe} timeframe`
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

      // Test database connectivity first
      console.log('Testing database connectivity...');
      const dbTest = await this.alpaca.testDatabaseConnection();
      if (!dbTest.success) {
        console.error('Database connectivity failed:', dbTest);
        return {
          success: false,
          reason: `Database connectivity issue: ${dbTest.error}`,
          symbol,
          timeframe,
          dbTest
        };
      }
      console.log('Database connectivity confirmed:', dbTest.message);

      // ENHANCED: Fetch long-term SMAs from Polygon.io
      console.log('Fetching long-term SMAs from Polygon.io...');
      let polygonSMAs = null;
      try {
        polygonSMAs = await this.polygonClient.getLongTermSMAs(symbol);
        console.log('Successfully fetched Polygon SMAs:', {
          sma200: polygonSMAs.sma200?.value,
          sma400: polygonSMAs.sma400?.value
        });
      } catch (polygonError) {
        console.warn('Failed to fetch Polygon SMAs, will use fallback calculation:', polygonError.message);
      }

      // Debug database content before querying
      console.log('Checking database content...');
      await this.alpaca.debugDatabaseContent(symbol, timeframe === '1Min' ? 'minute_bars' : 'aggregated_bars', this.alpaca.normalizeTimeframe(timeframe));

      // Get market data with better error handling
      console.log(`Fetching market data for ${symbol}...`);
      let bars;
      try {
        bars = await this.alpaca.getBarsFromDatabase(symbol, timeframe, 500);
      } catch (apiError) {
        console.error("Market data fetch error:", apiError);
        const dataAccessTest = await this.db.testDataAccess(symbol, 5);
        console.log('Data access test results:', dataAccessTest);
        return {
          success: false,
          reason: `Failed to fetch market data: ${apiError.message}`,
          symbol,
          timeframe,
          error: apiError.message,
          dataAccessTest
        };
      }

      // Enhanced data validation
      if (!bars || !Array.isArray(bars) || bars.length === 0) {
        console.warn("No market data received from database");
        const dataAccessTest = await this.db.testDataAccess(symbol, 5);
        console.log('Data access test results:', dataAccessTest);
        return {
          success: false,
          reason: "No market data available",
          symbol,
          timeframe,
          dataReceived: bars ? bars.length : 0,
          dataAccessTest,
          troubleshooting: {
            suggestion: "Check if data is being populated by the fetch-bars cron job",
            possibleCauses: [
              "RLS policies blocking data access",
              "Cron job not running or failing",
              "Database connection issues",
              "Timeframe format mismatch"
            ]
          }
        };
      }

      console.log(`Received ${bars.length} bars from database`);
      console.log(`Data range: ${bars[0]?.timestamp} to ${bars[bars.length - 1]?.timestamp}`);

      // More flexible data requirements
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

      // ENHANCED: Calculate indicators with Polygon.io data integration
      const closes = bars.map((bar) => bar.close);
      const highs = bars.map((bar) => bar.high);
      const lows = bars.map((bar) => bar.low);
      const volumes = bars.map((bar) => bar.volume);

      console.log("Calculating technical indicators...");

      // Calculate local MAs as fallback
      let ma200 = null;
      let ma400 = null;

      const minBarsForMA200 = 200;
      const minBarsForMA400 = 400;

      if (bars.length >= minBarsForMA200) {
        ma200 = this.indicators.sma(closes, 200);
        console.log("Calculated local 200 MA");
      }

      if (bars.length >= minBarsForMA400) {
        ma400 = this.indicators.sma(closes, 400);
        console.log("Calculated local 400 MA");
      }

      // ENHANCED: Prepare indicators object with Polygon.io data
      const indicators = {
        ma200,
        ma400,
        polygonSMA200: polygonSMAs?.sma200 || null,
        polygonSMA400: polygonSMAs?.sma400 || null
      };

      // Log which SMA sources are being used
      console.log('SMA sources being used:', {
        polygon200: !!indicators.polygonSMA200,
        polygon400: !!indicators.polygonSMA400,
        local200: !!ma200,
        local400: !!ma400
      });

      // ENHANCED: Detect levels with improved algorithm
      console.log("Detecting support/resistance levels with enhanced algorithm...");
      const levels = this.levelDetector.detectLevels(bars, indicators);
      console.log(`Detected ${levels.length} key levels`);

      // Enhanced logging with confidence scores
      const highConfidenceLevels = levels.filter(level => level.confidence && level.confidence > 0.8);
      console.log(`High confidence levels (>0.8): ${highConfidenceLevels.length}`);

      // Log levels to database for monitoring
      await this.logLevelsToDatabase(symbol, timeframe, levels, indicators);

      // ENHANCED: Detect flag patterns with improved criteria
      console.log("Analyzing flag patterns with enhanced criteria...");
      const analysisWindow = Math.min(100, bars.length); // Increased window for better analysis
      const flagPattern = this.flagDetector.detectFlag(
        bars.slice(-analysisWindow),
        levels
      );

      let signals = [];
      let trades = [];

      if (flagPattern && flagPattern.confluence > 2) { // Increased confluence requirement
        console.log(
          "Enhanced flag pattern detected:",
          {
            direction: flagPattern.direction,
            confluence: flagPattern.confluence,
            validity: flagPattern.validity?.rating,
            confidence: flagPattern.validity?.confidence
          }
        );

        // Enhanced signal generation with more criteria
        if (flagPattern.validity.rating === 'excellent' || 
           (flagPattern.validity.rating === 'very_good' && flagPattern.confluence > 3)) {

          const signal = {
            symbol,
            pattern: flagPattern,
            direction: flagPattern.direction,
            entry: flagPattern.breakoutLevel,
            confidence: flagPattern.validity.confidence,
            confluence: flagPattern.confluence,
            validityRating: flagPattern.validity.rating,
            volumeConfirmation: flagPattern.volume.confirmation,
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
              console.log("Attempting to execute trade with enhanced criteria...");

              // Enhanced trade execution with additional validation
              const trade = await this.executeTrade(signal, levels);
              if (trade) {
                trades.push(trade);
                await this.db.logTrade(trade);
                console.log("Enhanced trade executed and logged successfully");
              } else {
                console.log("Trade execution failed or no suitable option found");
              }
            } else {
              console.log(`Maximum positions (${maxPositions}) reached`);
            }
          } catch (positionError) {
            console.error("Error checking positions:", positionError);
          }
        } else {
          console.log(
            `Flag pattern detected but quality insufficient: ${flagPattern.validity.rating} (confluence: ${flagPattern.confluence})`
          );
        }
      } else {
        console.log(
          "No valid flag pattern detected or insufficient confluence:",
          flagPattern ? {
            confluence: flagPattern.confluence,
            validity: flagPattern.validity?.rating
          } : "No pattern"
        );
      }

      const result = {
        success: true,
        symbol,
        timeframe,
        dataReceived: bars.length,
        indicatorsUsed: {
          polygonSMA200: !!indicators.polygonSMA200,
          polygonSMA400: !!indicators.polygonSMA400,
          localMA200: ma200 ? ma200.length : 0,
          localMA400: ma400 ? ma400.length : 0,
        },
        smaValues: {
          polygon200: indicators.polygonSMA200?.value || null,
          polygon400: indicators.polygonSMA400?.value || null,
          local200: ma200 ? ma200[ma200.length - 1] : null,
          local400: ma400 ? ma400[ma400.length - 1] : null
        },
        levels: levels.length,
        highConfidenceLevels: highConfidenceLevels.length,
        flagPattern: flagPattern
          ? {
              direction: flagPattern.direction,
              confluence: flagPattern.confluence,
              validity: flagPattern.validity?.rating,
              confidence: flagPattern.validity?.confidence,
              volumeQuality: flagPattern.volume?.confirmation?.quality
            }
          : null,
        signals: signals.length,
        trades: trades.length,
        timestamp: new Date().toISOString(),
      };

      console.log("Enhanced strategy execution completed successfully:", result);
      return result;

    } catch (error) {
      console.error("Enhanced strategy execution error:", error);
      await this.db.logError({
        ...error,
        functionName: "LevelFlagStrategy.execute",
        symbol,
        timeframe,
      });
      throw error;
    }
  }

  async logLevelsToDatabase(symbol, timeframe, levels, indicators) {
    try {
      const levelsData = {
        symbol,
        timeframe,
        timestamp: new Date().toISOString(),
        // Polygon.io SMA values (preferred)
        polygon_ma200: indicators.polygonSMA200?.value || null,
        polygon_ma400: indicators.polygonSMA400?.value || null,
        polygon_ma200_timestamp: indicators.polygonSMA200?.timestamp || null,
        polygon_ma400_timestamp: indicators.polygonSMA400?.timestamp || null,
        // Local SMA values (fallback)
        local_ma200: indicators.ma200 ? indicators.ma200[indicators.ma200.length - 1] : null,
        local_ma400: indicators.ma400 ? indicators.ma400[indicators.ma400.length - 1] : null,
        // Level analysis
        detected_levels: levels,
        level_count: levels.length,
        high_confidence_levels: levels.filter(level => level.confidence && level.confidence > 0.8).length,
        confluence_levels: levels.filter(level => level.confluence && level.confluence > 1).length,
        // Data source tracking
        sma_data_source: {
          polygon200Available: !!indicators.polygonSMA200,
          polygon400Available: !!indicators.polygonSMA400,
          using_polygon_data: !!(indicators.polygonSMA200 || indicators.polygonSMA400)
        }
      };

      // Log to database for monitoring
      await this.db.logEvent('enhanced_levels_detected', levelsData);
      console.log(`Logged ${levels.length} enhanced levels to database for ${symbol} ${timeframe}`);
    } catch (error) {
      console.error('Error logging enhanced levels to database:', error);
      // Don't throw error as this is just for logging
    }
  }

  async executeTrade(signal, levels) {
    try {
      console.log(
        "Starting enhanced trade execution for signal:",
        signal.symbol,
        signal.direction
      );

      // Get account information
      const account = await this.alpaca.getAccount();
      const accountValue = parseFloat(account.equity);
      console.log(`Account value: $${accountValue}`);

      // Calculate position size with enhanced risk management
      const baseRiskAmount = accountValue * parseFloat(process.env.RISK_PER_TRADE || "0.01");

      // Adjust risk based on signal confidence
      const confidenceMultiplier = signal.confidence > 0.9 ? 1.2 : 
                                  signal.confidence > 0.8 ? 1.0 : 0.8;

      const adjustedRiskAmount = baseRiskAmount * confidenceMultiplier;
      console.log(`Risk amount per trade: $${adjustedRiskAmount} (confidence adjusted)`);

      // Get option chain
      let optionChain;
      try {
        optionChain = await this.alpaca.getOptionChain(signal.symbol);
      } catch (optionError) {
        console.error("Failed to get option chain:", optionError);
        return null;
      }

      // Enhanced option selection with signal data
      const selectedOption = this.optionSelector.selectOption(
        optionChain,
        signal.direction,
        adjustedRiskAmount,
        {
          confidence: signal.confidence,
          confluence: signal.confluence,
          levels: levels
        }
      );

      if (!selectedOption) {
        console.log("No suitable option found for enhanced signal");
        return null;
      }

      console.log("Selected option with enhanced criteria:", {
        symbol: selectedOption.symbol,
        strike: selectedOption.strike,
        expiration: selectedOption.expiration,
        price: selectedOption.price,
      });

      // Enhanced stop loss and take profit calculation
      const stopLoss = this.calculateEnhancedStopLoss(signal, selectedOption, levels);
      const takeProfit = this.calculateEnhancedTakeProfit(signal, selectedOption, levels);

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
      console.log("Enhanced order submitted successfully:", order.id);

      return {
        symbol: signal.symbol,
        optionContract: selectedOption.symbol,
        side: orderData.side,
        quantity: selectedOption.quantity,
        price: selectedOption.price,
        stopLoss,
        takeProfit,
        entryReason: `Enhanced level flag ${signal.direction} breakout`,
        signalConfidence: signal.confidence,
        confluence: signal.confluence,
        validityRating: signal.validityRating,
        orderId: order.id,
        status: "submitted",
        timestamp: new Date().toISOString(),
        enhancedFeatures: {
          polygonSMAUsed: true,
          confidenceAdjustedRisk: true,
          confluenceAnalysis: true
        }
      };

    } catch (error) {
      console.error("Enhanced trade execution error:", error);
      return null;
    }
  }

  calculateEnhancedStopLoss(signal, option, levels) {
    // Enhanced stop loss calculation considering support/resistance levels
    const baseStopLoss = option.price * 0.98; // 2% base stop loss

    // Find nearby support/resistance levels
    const nearbyLevels = levels.filter(level => {
      const priceDiff = Math.abs(level.value - option.price) / option.price;
      return priceDiff < 0.05; // Within 5%
    });

    if (nearbyLevels.length > 0) {
      // Use the nearest level as stop loss reference
      const nearestLevel = nearbyLevels.reduce((closest, level) => {
        const currentDiff = Math.abs(level.value - option.price);
        const closestDiff = Math.abs(closest.value - option.price);
        return currentDiff < closestDiff ? level : closest;
      });

      // Adjust stop loss based on level
      const levelStopLoss = signal.direction === 'bullish' 
        ? nearestLevel.value * 0.99  // Below support for bullish
        : nearestLevel.value * 1.01; // Above resistance for bearish

      return Math.max(baseStopLoss, Math.min(levelStopLoss, option.price * 0.95));
    }

    return Math.max(baseStopLoss, option.price * 0.95);
  }

  calculateEnhancedTakeProfit(signal, option, levels) {
    // Enhanced take profit considering confluence and confidence
    const baseRiskReward = 2.0; // Base 2:1 risk-reward

    // Adjust risk-reward based on signal quality
    const confidenceBonus = signal.confidence > 0.9 ? 0.5 : 
                           signal.confidence > 0.8 ? 0.25 : 0;

    const confluenceBonus = signal.confluence > 4 ? 0.5 : 
                           signal.confluence > 3 ? 0.25 : 0;

    const adjustedRiskReward = baseRiskReward + confidenceBonus + confluenceBonus;

    const risk = option.price * 0.02;
    return option.price + (risk * adjustedRiskReward);
  }

  async executeTimeframedStrategy(timeframe, force = false) {
    console.log(`Executing enhanced timeframed strategy: ${timeframe}, force: ${force}`);
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

    console.log("Proceeding with enhanced strategy execution...");
    return this.execute({
      symbol: "QQQ",
      timeframe,
      maxPositions: 3,
    });
  }
}
