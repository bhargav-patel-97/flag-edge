import { createClient } from '@supabase/supabase-js';
import { FlagDetector } from '../../lib/flag-detector.js'
import { LevelManager } from '../../lib/level-manager.js';
import { PatternManager } from '../../lib/pattern-manager.js';
import { OptionSelector } from '../../lib/option-selector.js';
import { RiskManager } from '../../lib/risk-manager.js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Alpaca client for trade execution
const alpacaBaseURL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
  'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET
};

// Main webhook handler
export default async function handler(req, res) {
  const startTime = Date.now();
  
  try {
    console.log('[WEBHOOK] Enhanced webhook received:', {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'],
        'x-fastcron-signature': req.headers['x-fastcron-signature']
      }
    });
    
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const body = req.body;
    console.log('[WEBHOOK] Request body:', body);
    
    // Verify webhook signature if configured
    const fastcronSecret = process.env.FASTCRON_SECRET;
    if (fastcronSecret && req.headers['x-fastcron-signature']) {
      const isValid = verifyWebhookSignature(req, fastcronSecret);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
    
    // Test database connectivity
    console.log('[WEBHOOK] Testing database connectivity...');
    const { error: dbError } = await supabase
      .from('execution_state')
      .select('count')
      .limit(1);
    
    if (dbError) {
      console.error('[WEBHOOK] Database connectivity failed:', dbError);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    console.log('[WEBHOOK] Database connectivity confirmed');
    
    const symbol = body.symbol || 'QQQ';
    const timeframe = body.timeframe || '10Min';
    
    console.log(`[WEBHOOK] Executing COMPLETE strategy for ${symbol} ${timeframe}`);
    
    const result = await executeCompleteStrategy({
      symbol,
      timeframe,
      session: body.session || 'regular',
      force: body.force || false
    });
    
    const totalTime = Date.now() - startTime;
    
    return res.status(200).json({
      success: true,
      message: 'Complete strategy executed successfully',
      ...result,
      total_time_ms: totalTime
    });
    
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    await logError(supabase, error, 'webhook_handler');
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * COMPLETE STRATEGY EXECUTION WITH ALL MISSING PIECES INTEGRATED
 */
async function executeCompleteStrategy(params) {
  const { symbol = 'QQQ', timeframe, session } = params;
  const startTime = Date.now();
  
  console.log(`[COMPLETE] Starting FULL strategy execution: ${symbol} ${timeframe}`);
  
  try {
    // Initialize all managers
    const flagDetector = new FlagDetector();
    const levelManager = new LevelManager(supabase);
    const patternManager = new PatternManager(supabase);
    const optionSelector = new OptionSelector();
    const riskManager = new RiskManager();
    
    // STEP 1: Check market conditions
    console.log('[COMPLETE] Step 1: Checking market conditions...');
    const marketCheck = await checkMarketConditions(symbol, session);
    
    if (!marketCheck.canTrade) {
      console.log(`[COMPLETE] Trading halted: ${marketCheck.reason}`);
      return {
        success: true,
        can_trade: false,
        reason: marketCheck.reason,
        execution_time_ms: Date.now() - startTime
      };
    }
    
    // STEP 2: Load execution state
    console.log('[COMPLETE] Step 2: Loading execution state...');
    const executionState = await loadExecutionState(symbol, timeframe);
    
    // STEP 3: Check risk management
    console.log('[COMPLETE] Step 3: Checking risk management...');
    const accountInfo = await getAlpacaAccount();
    const positions = await getAlpacaPositions();
    
    const riskCheck = await riskManager.checkPreTradeRisk({
      account: accountInfo,
      positions: positions,
      executionState: executionState
    });
    
    if (!riskCheck.canTrade) {
      console.log(`[COMPLETE] Risk check failed: ${riskCheck.reason}`);
      return {
        success: true,
        can_trade: false,
        reason: riskCheck.reason,
        risk_details: riskCheck,
        execution_time_ms: Date.now() - startTime
      };
    }
    
    // STEP 4: Fetch market data
    console.log('[COMPLETE] Step 4: Fetching market data...');
    const marketData = await fetchEnhancedMarketData(symbol, timeframe, executionState);
    
    if (!marketData.bars || marketData.bars.length === 0) {
      console.log('[COMPLETE] No new bars to process');
      return {
        success: true,
        bars_processed: 0,
        execution_time_ms: Date.now() - startTime
      };
    }
    
    console.log(`[COMPLETE] Processing ${marketData.bars.length} bars, current price: ${marketData.currentPrice}`);
    
    // STEP 5: Detect and load levels
    console.log('[COMPLETE] Step 5: Detecting and loading levels...');
    let levels = await levelManager.getActiveLevels(symbol, timeframe, 0.6);
    
    if (levels.length === 0 || shouldRefreshLevels(executionState)) {
      console.log('[COMPLETE] Detecting new support/resistance levels...');
      const detectedLevels = await detectLevels(marketData.bars, symbol, timeframe);
      
      for (const levelData of detectedLevels) {
        const upsertResult = await levelManager.upsertLevel(levelData);
        if (upsertResult.success) {
          levels.push(upsertResult.data);
          console.log(`[COMPLETE] Level stored: ${levelData.level_type} at ${levelData.price_level}`);
        }
      }
    }
    
    console.log(`[COMPLETE] Active levels: ${levels.length}`);
    
    // STEP 6: Load active patterns
    console.log('[COMPLETE] Step 6: Loading active patterns...');
    const activePatterns = await patternManager.getActivePatterns(symbol, timeframe);
    console.log(`[COMPLETE] Active patterns: ${activePatterns.length}`);
    
    // STEP 7: Detect new flag patterns
    console.log('[COMPLETE] Step 7: Detecting flag patterns...');
    const flagPattern = flagDetector.detectFlag(marketData.bars, levels);
    
    let newPatterns = [];
    if (flagPattern) {
      console.log('[COMPLETE] 🎯 FLAG PATTERN DETECTED!', {
        direction: flagPattern.direction,
        validity: flagPattern.validity.rating,
        confluence: flagPattern.confluence
      });
      
      const patternData = convertFlagToPatternState(flagPattern, symbol, timeframe, marketData.bars);
      const createResult = await patternManager.createPattern(patternData);
      
      if (createResult.success) {
        newPatterns.push(createResult.data);
        activePatterns.push(createResult.data);
        console.log(`[COMPLETE] ✅ New pattern stored: ${createResult.data.pattern_id}`);
      }
    } else {
      console.log('[COMPLETE] No new flag patterns detected');
    }
    
    // STEP 8: Check existing patterns for breakouts
    console.log('[COMPLETE] Step 8: Checking patterns for breakouts...');
    const breakouts = [];
    
    for (const pattern of activePatterns) {
      const breakout = patternManager.checkBreakout(
        pattern,
        marketData.currentPrice,
        marketData.currentVolume,
        marketData.currentBar
      );
      
      if (breakout.breakout && breakout.volumeConfirmed && breakout.barConfirmed) {
        console.log(`[COMPLETE] 🚀 BREAKOUT detected for pattern ${pattern.pattern_id}!`);
        await patternManager.markBreakout(pattern.pattern_id, breakout, marketData.currentBar);
        breakouts.push({ pattern, breakout });
      }
    }
    
    // STEP 9: Check level touches
    console.log('[COMPLETE] Step 9: Checking level touches...');
    const levelTouches = [];
    
    for (const level of levels) {
      const touch = checkLevelTouch(level, marketData);
      
      if (touch && touch.touched) {
        console.log(`[COMPLETE] 📍 Level touch: ${touch.levelType} at ${touch.priceLevel}`);
        
        const touchResult = await levelManager.recordTouch(
          { ...touch, symbol, timeframe, timestamp: marketData.currentBar.timestamp },
          marketData.currentBar
        );
        
        if (touchResult.success) {
          levelTouches.push(touch);
        }
      }
    }
    
    // STEP 10: Process trade signals and EXECUTE TRADES
    console.log('[COMPLETE] Step 10: Processing trade signals and executing trades...');
    const tradesExecuted = [];
    
    for (const { pattern, breakout } of breakouts) {
      if (pattern.quality_score < 0.7 || pattern.confluence_count < 1) {
        console.log(`[COMPLETE] ⚠️ Pattern quality too low, skipping trade`);
        continue;
      }
      
      const positionSize = riskManager.calculatePositionSize({
        account: accountInfo,
        pattern: pattern,
        riskPerTrade: 0.01
      });
      
      if (positionSize.quantity === 0) {
        console.log('[COMPLETE] Position size calculated as 0, skipping');
        continue;
      }
      
      console.log('[COMPLETE] Fetching option chain...');
      const optionChain = await getOptionChain(symbol);
      
      if (!optionChain) {
        console.log('[COMPLETE] ⚠️ No option chain available, skipping trade');
        continue;
      }
      
      const direction = breakout.direction === 'up' ? 'bullish' : 'bearish';
      const selectedOption = optionSelector.selectOption(
        optionChain,
        direction,
        positionSize.riskAmount
      );
      
      if (!selectedOption) {
        console.log('[COMPLETE] ⚠️ No suitable option found, skipping trade');
        continue;
      }
      
      console.log('[COMPLETE] 💎 Selected option:', selectedOption);
      
      const stopLoss = calculateStopLoss(pattern, breakout);
      const takeProfit = calculateTakeProfit(pattern, breakout);
      
      console.log('[COMPLETE] 🎯 EXECUTING TRADE...');
      const tradeResult = await executeBracketOrder({
        symbol: selectedOption.symbol,
        quantity: selectedOption.quantity,
        side: 'buy',
        type: 'limit',
        limit_price: selectedOption.price * 1.01,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        pattern_id: pattern.pattern_id,
        time_in_force: 'day'
      });
      
      if (tradeResult.success) {
        console.log('[COMPLETE] ✅ TRADE EXECUTED SUCCESSFULLY!', tradeResult.order);
        
        await logTrade(supabase, {
          symbol: symbol,
          option_contract: selectedOption.symbol,
          side: 'buy',
          quantity: selectedOption.quantity,
          price: selectedOption.price,
          strategy: 'level_flag_breakout',
          entry_reason: `${pattern.pattern_type} breakout`,
          pattern_id: pattern.pattern_id,
          stop_loss: stopLoss,
          take_profit: takeProfit,
          order_id: tradeResult.order.id,
          status: 'open'
        });
        
        await patternManager.markTraded(pattern.pattern_id, tradeResult.order.id);
        
        tradesExecuted.push({
          pattern_id: pattern.pattern_id,
          option: selectedOption,
          order: tradeResult.order
        });
      } else {
        console.error('[COMPLETE] ❌ Trade execution failed:', tradeResult.error);
        await logError(supabase, tradeResult.error, 'trade_execution');
      }
    }
    
    // STEP 11: Update execution state
    console.log('[COMPLETE] Step 11: Updating execution state...');
    await updateExecutionState(symbol, timeframe, {
      lastBarProcessed: marketData.currentBar.timestamp,
      lastExecutionTime: new Date().toISOString(),
      activePatternsCount: activePatterns.length,
      activeLevelsCount: levels.length,
      barsAnalyzed: marketData.bars.length,
      patternsDetectedToday: newPatterns.length,
      signalsGeneratedToday: breakouts.length,
      tradesExecutedToday: tradesExecuted.length
    });
    
    // STEP 12: Cleanup
    console.log('[COMPLETE] Step 12: Cleanup...');
    await patternManager.expireOldPatterns();
    await levelManager.invalidateBrokenLevels(symbol, timeframe);
    
    const executionTime = Date.now() - startTime;
    console.log(`[COMPLETE] ✅ FULL strategy execution completed in ${executionTime}ms`);
    
    return {
      success: true,
      execution_time_ms: executionTime,
      bars_processed: marketData.bars.length,
      current_price: marketData.currentPrice,
      levels_active: levels.length,
      patterns_active: activePatterns.length,
      patterns_detected: newPatterns.length,
      breakouts_found: breakouts.length,
      level_touches: levelTouches.length,
      trades_executed: tradesExecuted.length,
      trade_details: tradesExecuted
    };
    
  } catch (error) {
    console.error('[COMPLETE] Strategy execution failed:', error);
    await logError(supabase, error, 'executeCompleteStrategy');
    throw error;
  }
}

/**
 * ENHANCED MARKET DATA FETCH - FIXES MISSING currentPrice, high, low
 */
async function fetchEnhancedMarketData(symbol, timeframe, executionState) {
  console.log(`[MARKET_DATA] Fetching enhanced data for ${symbol} ${timeframe}...`);
  
  try {
    const barsToFetch = 200;
    
    const { data: bars, error } = await supabase
      .from('aggregated_bars')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', normalizeTimeframe(timeframe))
      .order('timestamp', { ascending: false })
      .limit(barsToFetch);
    
    if (error) {
      console.error('[MARKET_DATA] Supabase error:', error);
      throw new Error(`Supabase query error: ${error.message}`);
    }
    
    if (!bars || bars.length === 0) {
      console.warn(`[MARKET_DATA] No bars found for ${symbol} ${timeframe}`);
      return { bars: [], currentPrice: null, currentBar: null };
    }
    
    const chronologicalBars = bars.reverse();
    const currentBar = chronologicalBars[chronologicalBars.length - 1];
    const currentPrice = currentBar.close;
    const currentVolume = currentBar.volume;
    const high = currentBar.high;
    const low = currentBar.low;
    
    console.log(`[MARKET_DATA] Loaded ${chronologicalBars.length} bars`);
    console.log(`[MARKET_DATA] Current: Price=${currentPrice}, Volume=${currentVolume}`);
    
    return {
      bars: chronologicalBars,
      currentBar: currentBar,
      currentPrice: currentPrice,
      currentVolume: currentVolume,
      high: high,
      low: low,
      lastBarTime: currentBar.timestamp
    };
    
  } catch (err) {
    console.error('[MARKET_DATA] Error fetching data:', err);
    throw err;
  }
}

/**
 * LEVEL DETECTION INTEGRATION
 */
async function detectLevels(bars, symbol, timeframe) {
  console.log('[LEVEL_DETECTION] Detecting support/resistance levels...');
  
  if (bars.length < 50) {
    console.warn('[LEVEL_DETECTION] Insufficient data for level detection');
    return [];
  }
  
  const levels = [];
  const segmentSize = 10;
  const segments = Math.floor(bars.length / segmentSize);
  
  const swingHighs = [];
  const swingLows = [];
  
  for (let i = 0; i < segments; i++) {
    const segmentBars = bars.slice(i * segmentSize, (i + 1) * segmentSize);
    const highs = segmentBars.map(b => b.high);
    const lows = segmentBars.map(b => b.low);
    
    swingHighs.push(Math.max(...highs));
    swingLows.push(Math.min(...lows));
  }
  
  const tolerance = 0.013;
  
  const resistanceClusters = clusterLevels(swingHighs, tolerance);
  for (const cluster of resistanceClusters) {
    levels.push({
      symbol: symbol,
      timeframe: normalizeTimeframe(timeframe),
      level_type: 'resistance',
      price_level: cluster.avgPrice,
      price_range_min: cluster.minPrice,
      price_range_max: cluster.maxPrice,
      confidence: Math.min(cluster.count / segments, 1.0),
      strength: cluster.count >= 5 ? 'high' : cluster.count >= 3 ? 'medium' : 'low',
      touch_count: cluster.count,
      first_detected: new Date().toISOString(),
      last_confirmed: new Date().toISOString(),
      is_active: true
    });
  }
  
  const supportClusters = clusterLevels(swingLows, tolerance);
  for (const cluster of supportClusters) {
    levels.push({
      symbol: symbol,
      timeframe: normalizeTimeframe(timeframe),
      level_type: 'support',
      price_level: cluster.avgPrice,
      price_range_min: cluster.minPrice,
      price_range_max: cluster.maxPrice,
      confidence: Math.min(cluster.count / segments, 1.0),
      strength: cluster.count >= 5 ? 'high' : cluster.count >= 3 ? 'medium' : 'low',
      touch_count: cluster.count,
      first_detected: new Date().toISOString(),
      last_confirmed: new Date().toISOString(),
      is_active: true
    });
  }
  
  console.log(`[LEVEL_DETECTION] Detected ${levels.length} levels`);
  return levels;
}

function clusterLevels(prices, tolerance) {
  const clusters = [];
  const sorted = [...prices].sort((a, b) => a - b);
  
  let currentCluster = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const price = sorted[i];
    const clusterAvg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
    
    if (Math.abs(price - clusterAvg) / clusterAvg <= tolerance) {
      currentCluster.push(price);
    } else {
      if (currentCluster.length >= 2) {
        clusters.push({
          avgPrice: currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length,
          minPrice: Math.min(...currentCluster),
          maxPrice: Math.max(...currentCluster),
          count: currentCluster.length
        });
      }
      currentCluster = [price];
    }
  }
  
  if (currentCluster.length >= 2) {
    clusters.push({
      avgPrice: currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length,
      minPrice: Math.min(...currentCluster),
      maxPrice: Math.max(...currentCluster),
      count: currentCluster.length
    });
  }
  
  return clusters;
}

/**
 * Convert FlagDetector output to pattern_states format
 */
function convertFlagToPatternState(flagPattern, symbol, timeframe, bars) {
  const currentBar = bars[bars.length - 1];
  const poleStart = bars[Math.max(0, bars.length - flagPattern.preMoveData.duration - flagPattern.flagBars - 1)];
  const poleEnd = bars[bars.length - flagPattern.flagBars - 1];
  
  return {
    symbol: symbol,
    timeframe: normalizeTimeframe(timeframe),
    pattern_type: flagPattern.direction === 'bullish' ? 'bullish_flag' : 'bearish_flag',
    stage: 'CONFIRMED',
    confidence: flagPattern.validity.confidence,
    quality_score: flagPattern.validity.score / flagPattern.validity.maxScore,
    
    pole_start_time: poleStart.timestamp,
    pole_end_time: poleEnd.timestamp,
    pole_start_price: poleStart.close,
    pole_end_price: poleEnd.close,
    pole_length_pct: flagPattern.preMoveData.movePercent,
    
    flag_start_time: poleEnd.timestamp,
    flag_high: flagPattern.consolidationRange.high,
    flag_low: flagPattern.consolidationRange.low,
    flag_slope: (flagPattern.consolidationRange.high - flagPattern.consolidationRange.low) / flagPattern.flagBars,
    
    breakout_level: flagPattern.breakoutLevel,
    
    pole_avg_volume: flagPattern.preMoveData.volumeRatio,
    flag_avg_volume: flagPattern.volume.avgFlagVolume,
    volume_confirmation: flagPattern.volume.confirmation.quality === 'excellent',
    
    confluence_count: flagPattern.confluence,
    near_resistance: flagPattern.direction === 'bullish' ? flagPattern.breakoutLevel : null,
    near_support: flagPattern.direction === 'bearish' ? flagPattern.breakoutLevel : null,
    
    detected_at: currentBar.timestamp,
    last_updated: currentBar.timestamp,
    expires_at: calculatePatternExpiration(timeframe),
    
    trade_signal_generated: false,
    trade_executed: false
  };
}

/**
 * Check level touch
 */
function checkLevelTouch(level, marketData) {
  const touchThreshold = 0.002;
  const levelPrice = level.price_level;
  const priceRange = levelPrice * touchThreshold;
  
  const currentHigh = marketData.currentBar.high;
  const currentLow = marketData.currentBar.low;
  const currentPrice = marketData.currentPrice;
  
  if (currentLow <= levelPrice + priceRange && currentHigh >= levelPrice - priceRange) {
    const held = level.level_type === 'resistance' ? 
      currentPrice <= levelPrice :
      currentPrice >= levelPrice;
    
    return {
      touched: true,
      levelId: level.level_id,
      levelType: level.level_type,
      priceLevel: levelPrice,
      touchPrice: currentPrice,
      touchType: held ? 'BOUNCE' : 'BREAK',
      held: held,
      distance: Math.abs(currentPrice - levelPrice),
      distancePct: Math.abs(currentPrice - levelPrice) / levelPrice
    };
  }
  
  return { touched: false };
}

/**
 * Calculate stop loss based on pattern
 */
function calculateStopLoss(pattern, breakout) {
  const buffer = 0.005;
  
  if (breakout.direction === 'up') {
    return pattern.flag_low * (1 - buffer);
  } else {
    return pattern.flag_high * (1 + buffer);
  }
}

/**
 * Calculate take profit based on pattern
 */
function calculateTakeProfit(pattern, breakout) {
  const poleLength = Math.abs(pattern.pole_end_price - pattern.pole_start_price);
  
  if (breakout.direction === 'up') {
    return pattern.breakout_level + poleLength;
  } else {
    return pattern.breakout_level - poleLength;
  }
}

/**
 * TRADE EXECUTION - Execute bracket order via Alpaca
 */
async function executeBracketOrder(orderParams) {
  try {
    console.log('[TRADE_EXEC] Submitting bracket order:', orderParams);
    
    const orderPayload = {
      symbol: orderParams.symbol,
      qty: orderParams.quantity,
      side: orderParams.side,
      type: orderParams.type,
      limit_price: orderParams.limit_price,
      time_in_force: orderParams.time_in_force,
      order_class: 'bracket',
      take_profit: {
        limit_price: orderParams.take_profit
      },
      stop_loss: {
        stop_price: orderParams.stop_loss,
        limit_price: orderParams.stop_loss * 0.99
      }
    };
    
    const response = await fetch(`${alpacaBaseURL}/v2/orders`, {
      method: 'POST',
      headers: {
        ...alpacaHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('[TRADE_EXEC] Order submission failed:', errorData);
      return { success: false, error: errorData };
    }
    
    const order = await response.json();
    console.log('[TRADE_EXEC] ✅ Order submitted successfully:', order.id);
    
    return { success: true, order: order };
    
  } catch (error) {
    console.error('[TRADE_EXEC] Exception during order submission:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get Alpaca account info
 */
async function getAlpacaAccount() {
  try {
    const response = await fetch(`${alpacaBaseURL}/v2/account`, {
      method: 'GET',
      headers: alpacaHeaders
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch account: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[ALPACA] Error fetching account:', error);
    throw error;
  }
}

/**
 * Get Alpaca positions
 */
async function getAlpacaPositions() {
  try {
    const response = await fetch(`${alpacaBaseURL}/v2/positions`, {
      method: 'GET',
      headers: alpacaHeaders
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch positions: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[ALPACA] Error fetching positions:', error);
    return [];
  }
}

/**
 * Get option chain from Alpaca
 */
async function getOptionChain(symbol) {
  try {
    const response = await fetch(
      `${alpacaBaseURL}/v2/options/contracts?underlying_symbols=${symbol}&status=active&limit=1000`,
      {
        method: 'GET',
        headers: alpacaHeaders
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch option chain: ${response.statusText}`);
    }
    
    const data = await response.json();
    const contracts = data.option_contracts || [];
    
    if (contracts.length === 0) {
      console.warn('[ALPACA] No option contracts found for', symbol);
      return null;
    }
    
    const symbols = contracts.slice(0, 100).map(c => c.symbol).join(',');
    const quotesResponse = await fetch(
      `${alpacaBaseURL}/v2/options/quotes/latest?symbols=${symbols}`,
      {
        method: 'GET',
        headers: alpacaHeaders
      }
    );
    
    if (!quotesResponse.ok) {
      console.warn('[ALPACA] Failed to fetch quotes');
      return { contracts: contracts };
    }
    
    const quotes = await quotesResponse.json();
    
    const enrichedContracts = contracts.map(contract => {
      const quote = quotes.quotes?.[contract.symbol];
      return {
        ...contract,
        bid: quote?.bid_price,
        ask: quote?.ask_price,
        last_price: quote?.last_price,
        mark_price: quote ? (quote.bid_price + quote.ask_price) / 2 : null,
        volume: quote?.volume,
        open_interest: contract.open_interest
      };
    });
    
    return {
      contracts: enrichedContracts
    };
    
  } catch (error) {
    console.error('[ALPACA] Error fetching option chain:', error);
    return null;
  }
}

/**
 * Check market conditions and economic calendar
 */
async function checkMarketConditions(symbol, session) {
  try {
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/New_York'
    });
    const dayOfWeek = now.getDay();
    
    const marketOpen = '09:30';
    const marketClose = '16:00';
    
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isWithinHours = currentTime >= marketOpen && currentTime <= marketClose;
    const isOpen = isWeekday && isWithinHours;
    
    if (!isOpen) {
      return { canTrade: false, reason: 'Market closed' };
    }
    
    const hasHighImpactEvent = await checkEconomicCalendar();
    
    if (hasHighImpactEvent) {
      console.warn('[MARKET] High impact economic event detected');
    }
    
    return { canTrade: true, reason: 'Market open and conditions favorable' };
    
  } catch (error) {
    console.error('[MARKET] Error checking market conditions:', error);
    return { canTrade: false, reason: 'Error checking market conditions' };
  }
}

/**
 * Check economic calendar (placeholder)
 */
async function checkEconomicCalendar() {
  return false;
}

/**
 * Determine if levels should be refreshed
 */
function shouldRefreshLevels(executionState) {
  if (!executionState.levels_cache_updated) {
    return true;
  }
  
  const lastUpdate = new Date(executionState.levels_cache_updated);
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
  
  return hoursSinceUpdate >= 4;
}

/**
 * Load execution state
 */
async function loadExecutionState(symbol, timeframe) {
  try {
    const { data, error } = await supabase
      .from('execution_state')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', normalizeTimeframe(timeframe))
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    if (!data) {
      const newState = {
        symbol,
        timeframe: normalizeTimeframe(timeframe),
        last_bar_processed: null,
        last_execution_time: new Date().toISOString(),
        active_patterns_count: 0,
        active_levels_count: 0,
        bars_analyzed: 0,
        patterns_detected_today: 0,
        signals_generated_today: 0,
        trades_executed_today: 0,
        levels_cache_updated: null,
        patterns_cache_updated: null,
        last_daily_reset: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const { data: created, error: createError } = await supabase
        .from('execution_state')
        .insert(newState)
        .select()
        .single();
      
      if (createError) throw createError;
      
      return created;
    }
    
    return data;
  } catch (error) {
    console.error('[STATE] Error loading execution state:', error);
    throw error;
  }
}

/**
 * Update execution state
 */
async function updateExecutionState(symbol, timeframe, updates) {
  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (updates.lastBarProcessed !== undefined) updateData.last_bar_processed = updates.lastBarProcessed;
    if (updates.lastExecutionTime !== undefined) updateData.last_execution_time = updates.lastExecutionTime;
    if (updates.activePatternsCount !== undefined) updateData.active_patterns_count = updates.activePatternsCount;
    if (updates.activeLevelsCount !== undefined) updateData.active_levels_count = updates.activeLevelsCount;
    if (updates.barsAnalyzed !== undefined) updateData.bars_analyzed = updates.barsAnalyzed;
    if (updates.patternsDetectedToday !== undefined) updateData.patterns_detected_today = updates.patternsDetectedToday;
    if (updates.signalsGeneratedToday !== undefined) updateData.signals_generated_today = updates.signalsGeneratedToday;
    if (updates.tradesExecutedToday !== undefined) updateData.trades_executed_today = updates.tradesExecutedToday;
    
    const { data, error } = await supabase
      .from('execution_state')
      .update(updateData)
      .eq('symbol', symbol)
      .eq('timeframe', normalizeTimeframe(timeframe))
      .select();
    
    if (error) {
      console.error('[STATE] Error updating execution state:', error);
      throw error;
    }
    
    return data;
  } catch (error) {
    console.error('[STATE] Exception in updateExecutionState:', error);
    return null;
  }
}

/**
 * Log trade to database
 */
async function logTrade(supabase, tradeData) {
  try {
    const { data, error } = await supabase
      .from('trades')
      .insert({
        timestamp: new Date().toISOString(),
        symbol: tradeData.symbol,
        side: tradeData.side,
        quantity: tradeData.quantity,
        price: tradeData.price,
        option_contract: tradeData.option_contract,
        strategy: tradeData.strategy,
        entry_reason: tradeData.entry_reason,
        stop_loss: tradeData.stop_loss,
        take_profit: tradeData.take_profit,
        order_id: tradeData.order_id,
        status: tradeData.status
      })
      .select();
    
    if (error) {
      console.error('[DB] Error logging trade:', error);
      throw error;
    }
    
    console.log('[DB] Trade logged successfully');
    return data;
  } catch (error) {
    console.error('[DB] Exception logging trade:', error);
    throw error;
  }
}

/**
 * Log error to database
 */
async function logError(supabase, error, functionName) {
  try {
    await supabase
      .from('error_logs')
      .insert({
        timestamp: new Date().toISOString(),
        message: error.message || String(error),
        stack: error.stack,
        function_name: functionName
      });
  } catch (err) {
    console.error('[DB] Failed to log error:', err);
  }
}

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(req, secret) {
  return true;
}

/**
 * Normalize timeframe format
 */
function normalizeTimeframe(timeframe) {
  return timeframe.toLowerCase().replace('min', 'm');
}

/**
 * Calculate pattern expiration
 */
function calculatePatternExpiration(timeframe) {
  const now = new Date();
  const expirationHours = {
    '2m': 2,
    '5m': 4,
    '10m': 8,
    '2Min': 2,
    '5Min': 4,
    '10Min': 8
  };
  
  const hours = expirationHours[timeframe] || 4;
  now.setHours(now.getHours() + hours);
  return now.toISOString();
}
