// lib/enhanced-level-flag-strategy.js
// Enhanced strategy with state persistence across Vercel Edge Function invocations

import { PatternManager } from './pattern-manager.js';
import { LevelManager } from './level-manager.js';
import { ExecutionStateManager } from './execution-state-manager.js';

export async function executeEnhancedStrategy(symbol, timeframe, supabase, options = {}) {
  const startTime = Date.now();
  console.log(`[ENHANCED] Starting enhanced strategy execution: ${symbol} ${timeframe}`);
  
  try {
    // Initialize managers
    const patternMgr = new PatternManager(supabase);
    const levelMgr = new LevelManager(supabase);
    const stateMgr = new ExecutionStateManager(supabase);
    
    // STEP 1: Load execution state and determine what needs processing
    console.log('[ENHANCED] Step 1: Loading execution state...');
    const execState = await stateMgr.getExecutionState(symbol, timeframe);
    
    // STEP 2: Load active context from database
    console.log('[ENHANCED] Step 2: Loading active patterns and levels...');
    const [activePatterns, activeLevels] = await Promise.all([
      patternMgr.getActivePatterns(symbol, timeframe),
      levelMgr.getActiveLevels(symbol, timeframe, 0.6) // Lower threshold for monitoring
    ]);
    
    console.log(`[ENHANCED] Active context loaded: ${activePatterns.length} patterns, ${activeLevels.length} levels`);
    
    // STEP 3: Fetch new market data
    console.log('[ENHANCED] Step 3: Fetching market data...');
    const bars = await fetchRecentBars(supabase, symbol, timeframe, execState, options.limit);
    
    if (!bars || bars.length === 0) {
      console.log('[ENHANCED] No new bars to process');
      return {
        success: true,
        message: 'No new data to process',
        execution_time_ms: Date.now() - startTime
      };
    }
    
    const currentBar = bars[bars.length - 1];
    console.log(`[ENHANCED] Processing ${bars.length} bars, current price: ${currentBar.close}`);
    
    // STEP 4: Check existing patterns for breakouts
    console.log('[ENHANCED] Step 4: Checking active patterns for breakouts...');
    const signals = [];
    
    for (const pattern of activePatterns) {
      const breakout = patternMgr.checkBreakout(
        pattern,
        currentBar.close,
        currentBar.volume,
        currentBar
      );
      
      if (breakout.breakout) {
        console.log(`[ENHANCED] 🚀 BREAKOUT detected for pattern ${pattern.pattern_id}!`);
        console.log(`[ENHANCED] Breakout details:`, breakout);
        
        if (breakout.volumeConfirmed && breakout.barConfirmed) {
          // Mark pattern as broken out
          const markResult = await patternMgr.markBreakout(pattern.pattern_id, breakout, currentBar);
          
          if (markResult.success) {
            signals.push({
              type: 'PATTERN_BREAKOUT',
              pattern,
              breakout,
              timestamp: currentBar.timestamp,
              confidence: pattern.confidence,
              quality_score: pattern.quality_score
            });
            
            console.log(`[ENHANCED] ✅ Pattern breakout signal generated`);
          }
        } else {
          console.log(`[ENHANCED] ⚠️ Breakout needs confirmation (volume: ${breakout.volumeConfirmed}, bar: ${breakout.barConfirmed})`);
        }
      }
    }
    
    // STEP 5: Check level touches
    console.log('[ENHANCED] Step 5: Checking level touches...');
    const levelTouches = [];
    
    for (const level of activeLevels) {
      const touch = levelMgr.checkLevelTouch(level, currentBar);
      
      if (touch && touch.touched) {
        console.log(`[ENHANCED] 📍 Level touch: ${touch.levelType} at ${touch.priceLevel} (${touch.touchType})`);
        
        const touchResult = await levelMgr.recordTouch({
          ...touch,
          symbol,
          timeframe,
          timestamp: currentBar.timestamp
        }, currentBar);
        
        if (touchResult.success) {
          levelTouches.push(touch);
        }
      }
    }
    
    // STEP 6: Detect new patterns (if not forcing existing pattern processing only)
    console.log('[ENHANCED] Step 6: Detecting new patterns...');
    const newPatterns = [];
    
    if (!options.skipNewPatternDetection) {
      // Use existing flag detection logic but store results in database
      const detectedPatterns = await detectNewFlagPatterns(bars, symbol, timeframe);
      
      for (const patternData of detectedPatterns) {
        // Check confluence with existing levels
        const confluence = await checkPatternConfluence(patternData, activeLevels);
        patternData.confluence_count = confluence.count;
        patternData.near_resistance = confluence.nearResistance;
        patternData.near_support = confluence.nearSupport;
        
        // Only create high-quality patterns with good confluence
        if (patternData.quality_score > 0.6 && confluence.count >= 1) {
          console.log(`[ENHANCED] 🎯 High-quality pattern detected with confluence: ${patternData.pattern_type}`);
          
          const createResult = await patternMgr.createPattern(patternData);
          if (createResult.success) {
            newPatterns.push(createResult.data);
            console.log(`[ENHANCED] ✅ New pattern stored: ${createResult.data.pattern_id}`);
          }
        } else {
          console.log(`[ENHANCED] ⚠️ Pattern filtered out (quality: ${patternData.quality_score}, confluence: ${confluence.count})`);
        }
      }
    }
    
    // STEP 7: Detect/Update levels
    console.log('[ENHANCED] Step 7: Updating levels...');
    const levelUpdates = [];
    
    // Convert any levels from legacy system_events format and upsert them
    if (options.legacyLevels && Array.isArray(options.legacyLevels)) {
      const convertedLevels = levelMgr.convertSystemEventsLevels(options.legacyLevels, symbol, timeframe);
      
      for (const levelData of convertedLevels) {
        const upsertResult = await levelMgr.upsertLevel(levelData);
        if (upsertResult.success) {
          levelUpdates.push(upsertResult.data);
          console.log(`[ENHANCED] 📊 Level ${upsertResult.created ? 'created' : 'updated'}: ${levelData.level_type} at ${levelData.price_level}`);
        }
      }
    }
    
    // STEP 8: Generate trade signals from breakouts
    console.log('[ENHANCED] Step 8: Processing trade signals...');
    const tradeSignals = [];
    
    for (const signal of signals) {
      // Additional validation before generating trade signal
      const signalValidation = await validateTradeSignal(signal, activeLevels, options);
      
      if (signalValidation.valid) {
        const tradeSignal = await generateEnhancedTradeSignal(supabase, signal, signalValidation);
        if (tradeSignal.success) {
          tradeSignals.push(tradeSignal.data);
          console.log(`[ENHANCED] 💰 Trade signal generated: ${tradeSignal.data.signal_id}`);
        }
      } else {
        console.log(`[ENHANCED] ⚠️ Trade signal filtered: ${signalValidation.reason}`);
      }
    }
    
    // STEP 9: Update execution state
    console.log('[ENHANCED] Step 9: Updating execution state...');
    const stateUpdates = {
      last_bar_processed: currentBar.timestamp,
      active_patterns_count: activePatterns.length + newPatterns.length,
      active_levels_count: activeLevels.length + levelUpdates.length,
      bars_analyzed: bars.length
    };
    
    // Increment daily counters
    await stateMgr.incrementCounters(symbol, timeframe, {
      patterns_detected: newPatterns.length,
      signals_generated: tradeSignals.length,
      bars_analyzed: bars.length
    });
    
    await stateMgr.updateExecutionState(symbol, timeframe, stateUpdates);
    
    // STEP 10: Cleanup expired patterns and broken levels
    console.log('[ENHANCED] Step 10: Cleanup...');
    const [expiredResult, invalidatedResult] = await Promise.all([
      patternMgr.expireOldPatterns(),
      levelMgr.invalidateBrokenLevels(symbol, timeframe)
    ]);
    
    const executionTime = Date.now() - startTime;
    console.log(`[ENHANCED] ✅ Enhanced strategy execution completed in ${executionTime}ms`);
    
    // STEP 11: Prepare comprehensive result
    const result = {
      success: true,
      execution_time_ms: executionTime,
      timestamp: new Date().toISOString(),
      
      // Input data
      bars_processed: bars.length,
      current_price: currentBar.close,
      current_volume: currentBar.volume,
      
      // Active context
      active_patterns_checked: activePatterns.length,
      active_levels_checked: activeLevels.length,
      
      // Pattern activity
      patterns_broken_out: signals.length,
      new_patterns_detected: newPatterns.length,
      
      // Level activity
      level_touches: levelTouches.length,
      levels_updated: levelUpdates.length,
      
      // Trade activity
      trade_signals_generated: tradeSignals.length,
      
      // Cleanup
      patterns_expired: expiredResult.success ? expiredResult.expiredCount : 0,
      levels_invalidated: invalidatedResult.success ? invalidatedResult.invalidatedCount : 0,
      
      // Detailed results
      breakout_signals: signals.map(s => ({
        pattern_id: s.pattern.pattern_id,
        pattern_type: s.pattern.pattern_type,
        breakout_direction: s.breakout.direction,
        breakout_strength: s.breakout.breakoutStrength,
        volume_confirmed: s.breakout.volumeConfirmed
      })),
      
      level_touches_detail: levelTouches.map(t => ({
        level_type: t.levelType,
        price_level: t.priceLevel,
        touch_type: t.touchType,
        held: t.held
      })),
      
      new_patterns_detail: newPatterns.map(p => ({
        pattern_id: p.pattern_id,
        pattern_type: p.pattern_type,
        quality_score: p.quality_score,
        confluence_count: p.confluence_count
      }))
    };
    
    // Log summary to system_events
    await logEnhancedExecutionSummary(supabase, symbol, timeframe, result);
    
    return result;
    
  } catch (error) {
    console.error('[ENHANCED] Strategy execution failed:', error);
    
    const errorResult = {
      success: false,
      error: error.message,
      execution_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
    
    // Log error
    await logEnhancedExecutionError(supabase, symbol, timeframe, errorResult);
    
    return errorResult;
  }
}

/**
 * Fetch recent bars with smart filtering based on execution state
 */
async function fetchRecentBars(supabase, symbol, timeframe, execState, limit = 100) {
  try {
    let query = supabase
      .from('aggregated_bars')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', normalizeTimeframe(timeframe))
      .order('timestamp', { ascending: false })
      .limit(limit);
    
    // If we have processed bars before, only get newer ones
    const timestampFilter = execState.last_bar_processed;
    if (timestampFilter) {
      query = query.gt('timestamp', timestampFilter);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching bars:', error);
      return [];
    }
    
    // Sort chronologically (oldest first)
    return (data || []).reverse();
  } catch (err) {
    console.error('Exception in fetchRecentBars:', err);
    return [];
  }
}

/**
 * Normalize timeframe format (10Min -> 10m)
 */
function normalizeTimeframe(timeframe) {
  return timeframe.toLowerCase().replace('min', 'm');
}

/**
 * Detect new flag patterns using existing logic
 */
async function detectNewFlagPatterns(bars, symbol, timeframe) {
  // This would integrate with existing flag detection logic
  // For now, return empty array as placeholder
  // TODO: Integrate with existing flag-detector.js logic
  
  console.log(`[ENHANCED] Flag pattern detection not yet integrated - placeholder`);
  return [];
}

/**
 * Check pattern confluence with existing levels
 */
async function checkPatternConfluence(patternData, activeLevels) {
  const confluence = {
    count: 0,
    nearResistance: null,
    nearSupport: null,
    levels: []
  };
  
  if (!patternData.breakout_level) {
    return confluence;
  }
  
  const breakoutLevel = patternData.breakout_level;
  const confluenceThreshold = breakoutLevel * 0.01; // 1% range
  
  for (const level of activeLevels) {
    const distance = Math.abs(level.price_level - breakoutLevel);
    const distancePct = distance / breakoutLevel;
    
    if (distance <= confluenceThreshold) {
      confluence.count++;
      confluence.levels.push({
        level_id: level.level_id,
        level_type: level.level_type,
        price_level: level.price_level,
        confidence: level.confidence,
        distance_pct: distancePct
      });
      
      if (level.level_type.includes('resistance') && breakoutLevel < level.price_level) {
        confluence.nearResistance = level.price_level;
      } else if (level.level_type.includes('support') && breakoutLevel > level.price_level) {
        confluence.nearSupport = level.price_level;
      }
    }
  }
  
  return confluence;
}

/**
 * Validate trade signal before execution
 */
async function validateTradeSignal(signal, activeLevels, options = {}) {
  const validation = {
    valid: true,
    reason: null,
    risk_score: 0
  };
  
  // Basic validations
  if (signal.pattern.quality_score < 0.7) {
    validation.valid = false;
    validation.reason = `Low pattern quality: ${signal.pattern.quality_score}`;
    return validation;
  }
  
  if (signal.pattern.confluence_count < 1) {
    validation.valid = false;
    validation.reason = `Insufficient confluence: ${signal.pattern.confluence_count}`;
    return validation;
  }
  
  if (!signal.breakout.volumeConfirmed) {
    validation.valid = false;
    validation.reason = 'Volume not confirmed';
    return validation;
  }
  
  // Additional validations can be added here
  // - Time of day restrictions
  // - Economic calendar events
  // - Risk management checks
  
  return validation;
}

/**
 * Generate enhanced trade signal with full context
 */
async function generateEnhancedTradeSignal(supabase, signal, validation) {
  try {
    const tradeSignal = {
      signal_id: `${signal.pattern.pattern_id}_${Date.now()}`,
      pattern_id: signal.pattern.pattern_id,
      symbol: signal.pattern.symbol,
      timeframe: signal.pattern.timeframe,
      signal_type: 'PATTERN_BREAKOUT',
      direction: signal.breakout.direction,
      
      entry_price: signal.breakout.currentPrice,
      breakout_level: signal.pattern.breakout_level,
      
      stop_loss: signal.pattern.pattern_type === 'bullish_flag' ? 
        signal.pattern.flag_low : signal.pattern.flag_high,
      
      take_profit: calculateTakeProfit(signal.pattern, signal.breakout),
      
      confidence: signal.pattern.confidence,
      quality_score: signal.pattern.quality_score,
      risk_score: validation.risk_score,
      
      volume_confirmed: signal.breakout.volumeConfirmed,
      breakout_strength: signal.breakout.breakoutStrength,
      
      generated_at: signal.timestamp,
      expires_at: calculateSignalExpiration(signal.pattern.timeframe)
    };
    
    // Store signal in strategy_executions table
    const { data, error } = await supabase
      .from('strategy_executions')
      .insert({
        symbol: tradeSignal.symbol,
        timeframe: tradeSignal.timeframe,
        strategy: 'enhanced_level_flag',
        signal_type: tradeSignal.signal_type,
        direction: tradeSignal.direction,
        entry_price: tradeSignal.entry_price,
        stop_loss: tradeSignal.stop_loss,
        take_profit: tradeSignal.take_profit,
        confidence: tradeSignal.confidence,
        metadata: {
          signal_id: tradeSignal.signal_id,
          pattern_id: tradeSignal.pattern_id,
          quality_score: tradeSignal.quality_score,
          breakout_strength: tradeSignal.breakout_strength,
          volume_confirmed: tradeSignal.volume_confirmed
        },
        executed_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error storing trade signal:', error);
      return { success: false, error };
    }
    
    return { success: true, data: tradeSignal };
  } catch (err) {
    console.error('Exception in generateEnhancedTradeSignal:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Calculate take profit level based on pattern geometry
 */
function calculateTakeProfit(pattern, breakout) {
  if (!pattern.pole_length_pct) {
    // Fallback to simple multiple of breakout level
    return breakout.currentPrice * (breakout.direction === 'up' ? 1.02 : 0.98);
  }
  
  // Project pole length from breakout level
  const poleLength = Math.abs(pattern.pole_end_price - pattern.pole_start_price);
  
  if (breakout.direction === 'up') {
    return breakout.currentPrice + poleLength;
  } else {
    return breakout.currentPrice - poleLength;
  }
}

/**
 * Calculate signal expiration time
 */
function calculateSignalExpiration(timeframe) {
  const now = new Date();
  const expirationMinutes = {
    '2m': 30,
    '5m': 60,
    '10m': 120,
    '2Min': 30,
    '5Min': 60,
    '10Min': 120
  };
  
  const minutes = expirationMinutes[timeframe] || 60;
  now.setMinutes(now.getMinutes() + minutes);
  return now.toISOString();
}

/**
 * Log execution summary to system_events
 */
async function logEnhancedExecutionSummary(supabase, symbol, timeframe, result) {
  try {
    await supabase
      .from('system_events')
      .insert({
        event_type: 'ENHANCED_STRATEGY_EXECUTION',
        symbol,
        timeframe,
        timestamp: result.timestamp,
        event_details: {
          execution_time_ms: result.execution_time_ms,
          bars_processed: result.bars_processed,
          patterns_checked: result.active_patterns_checked,
          levels_checked: result.active_levels_checked,
          breakouts: result.patterns_broken_out,
          new_patterns: result.new_patterns_detected,
          level_touches: result.level_touches,
          trade_signals: result.trade_signals_generated,
          success: result.success
        }
      });
  } catch (err) {
    console.error('Error logging execution summary:', err);
  }
}

/**
 * Log execution error to system_events
 */
async function logEnhancedExecutionError(supabase, symbol, timeframe, errorResult) {
  try {
    await supabase
      .from('system_events')
      .insert({
        event_type: 'ENHANCED_STRATEGY_ERROR',
        symbol,
        timeframe,
        timestamp: errorResult.timestamp,
        event_details: {
          error: errorResult.error,
          execution_time_ms: errorResult.execution_time_ms
        }
      });
  } catch (err) {
    console.error('Error logging execution error:', err);
  }
}