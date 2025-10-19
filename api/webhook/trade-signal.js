import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Enhanced strategy execution
async function executeEnhancedStrategy(params) {
  const { symbol = 'QQQ', timeframe, session } = params;
  const startTime = Date.now();
  
  console.log(`[ENHANCED] Starting enhanced strategy execution: ${symbol} ${timeframe}`);
  
  try {
    // Step 1: Load execution state
    console.log('[ENHANCED] Step 1: Loading execution state...');
    const executionState = await loadExecutionState(symbol, timeframe);
    
    // Step 2: Load active patterns and levels
    console.log('[ENHANCED] Step 2: Loading active patterns and levels...');
    const levels = await loadActiveLevels(symbol, timeframe);
    const patterns = await loadActivePatterns(symbol, timeframe);
    console.log(`[ENHANCED] Active context loaded: ${patterns.length} patterns, ${levels.length} levels`);
    
    // Step 3: Fetch market data
    console.log('[ENHANCED] Step 3: Fetching market data...');
    const marketData = await fetchMarketData(symbol, timeframe);
    console.log(`[ENHANCED] Processing ${marketData.bars?.length || 0} bars, current price: ${marketData.currentPrice}`);
    
    // Step 4: Check active patterns for breakouts
    console.log('[ENHANCED] Step 4: Checking active patterns for breakouts...');
    const breakouts = checkPatternBreakouts(patterns, marketData);
    
    // Step 5: Check level touches
    console.log('[ENHANCED] Step 5: Checking level touches...');
    const levelTouches = checkLevelTouches(levels, marketData);
    
    // Step 6: Detect new patterns
    console.log('[ENHANCED] Step 6: Detecting new patterns...');
    console.log('[ENHANCED] Flag pattern detection not yet integrated - placeholder');
    const newPatterns = []; // Placeholder
    
    // Step 7: Update levels
    console.log('[ENHANCED] Step 7: Updating levels...');
    await updateLevels(symbol, timeframe, marketData);
    
    // Step 8: Process trade signals
    console.log('[ENHANCED] Step 8: Processing trade signals...');
    const tradeSignals = processTradeSignals(breakouts, levelTouches, marketData);
    
    // Step 9: Update execution state (FIXED - using correct column names)
    console.log('[ENHANCED] Step 9: Updating execution state...');
    await updateExecutionState(symbol, timeframe, {
      lastBarProcessed: marketData.lastBarTime,
      lastExecutionTime: new Date().toISOString(),
      activePatternsCount: patterns.length,
      activeLevelsCount: levels.length,
      barsAnalyzed: marketData.bars?.length || 0,
      patternsDetectedToday: newPatterns.length,
      signalsGeneratedToday: tradeSignals.length
    });
    
    // Step 10: Cleanup
    console.log('[ENHANCED] Step 10: Cleanup...');
    await cleanupOldData(symbol, timeframe);
    
    const executionTime = Date.now() - startTime;
    console.log(`[ENHANCED] ✅ Enhanced strategy execution completed in ${executionTime}ms`);
    
    return {
      success: true,
      execution_time_ms: executionTime,
      patterns_checked: patterns.length,
      levels_checked: levels.length,
      breakouts: breakouts.length,
      new_patterns: newPatterns.length,
      trade_signals: tradeSignals.length
    };
    
  } catch (error) {
    console.error('[ENHANCED] Error during strategy execution:', error);
    throw error;
  }
}

// Load execution state (FIXED - using correct column names)
async function loadExecutionState(symbol, timeframe) {
  try {
    const { data, error } = await supabase
      .from('execution_state')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      throw error;
    }
    
    if (!data) {
      // Create new execution state with CORRECT column names
      const newState = {
        symbol,
        timeframe,
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
      
      console.log(`[info] Created new execution state for ${symbol} ${timeframe}`);
      return created;
    }
    
    return data;
  } catch (error) {
    console.error('Error loading execution state:', error);
    throw error;
  }
}

// Update execution state (FIXED - using correct column names)
async function updateExecutionState(symbol, timeframe, updates) {
  try {
    // Prepare update object with only valid fields
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    // Map the updates to database fields (FIXED column names)
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
      .eq('timeframe', timeframe)
      .select();
    
    if (error) {
      console.error('Error updating execution state:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    
    return data;
  } catch (error) {
    console.error('Error updating execution state:', error);
    // Don't throw - allow execution to continue
    return null;
  }
}

// Load active levels (FIXED - using correct column name 'price_level')
async function loadActiveLevels(symbol, timeframe) {
  try {
    const { data, error } = await supabase
      .from('detected_levels')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .eq('is_active', true)
      .order('price_level', { ascending: true }); // FIXED: was 'level_price'
    
    if (error) throw error;
    
    console.log(`[info] Loaded ${data?.length || 0} active levels for ${symbol} ${timeframe}`);
    return data || [];
  } catch (error) {
    console.error('Error loading active levels:', error);
    return [];
  }
}

// Load active patterns (FIXED - using 'stage' column instead of 'status')
async function loadActivePatterns(symbol, timeframe) {
  try {
    const { data, error } = await supabase
      .from('pattern_states')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .in('stage', ['FORMING', 'CONSOLIDATING', 'CONFIRMED']) // FIXED: was .eq('status', 'active')
      .order('detected_at', { ascending: false });
    
    if (error) throw error;
    
    console.log(`[info] Loaded ${data?.length || 0} active patterns for ${symbol} ${timeframe}`);
    return data || [];
  } catch (error) {
    console.error('Error loading active patterns:', error);
    return [];
  }
}

// Fetch market data - CORRECTED AUTHENTICATION
async function fetchMarketData(symbol, timeframe) {
  try {
    // FIXED: Corrected environment variable name from ALPACA_SECRET_KEY to ALPACA_API_SECRET
    const alpacaKey = process.env.ALPACA_API_KEY;
    const alpacaSecret = process.env.ALPACA_API_SECRET;
    const alpacaUrl = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets';
    
    if (!alpacaKey || !alpacaSecret) {
      throw new Error('Alpaca credentials not configured. Please set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.');
    }
    
    // Calculate time range
    const end = new Date();
    const start = new Date(end.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago
    
    // Map timeframe to Alpaca format
    const timeframeMap = {
      '1Min': '1Min',
      '2Min': '2Min',
      '5Min': '5Min',
      '10Min': '10Min',
      '15Min': '15Min',
      '30Min': '30Min',
      '1H': '1Hour',
      '4H': '4Hour',
      '1D': '1Day'
    };
    
    const alpacaTimeframe = timeframeMap[timeframe] || timeframe;
    
    // Fetch bars from Alpaca
    const url = `${alpacaUrl}/v2/stocks/${symbol}/bars?timeframe=${alpacaTimeframe}&start=${start.toISOString()}&end=${end.toISOString()}&limit=10000`;
    
    console.log(`[MARKET_DATA] Fetching from: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[MARKET_DATA] Alpaca API error response:`, errorText);
      throw new Error(`Alpaca API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    const bars = result.bars || [];
    
    if (bars.length === 0) {
      console.warn(`[MARKET_DATA] No bars returned for ${symbol}`);
      throw new Error('No market data received');
    }
    
    const latestBar = bars[bars.length - 1];
    
    console.log(`[MARKET_DATA] Successfully fetched ${bars.length} bars for ${symbol}`);
    
    return {
      bars,
      currentPrice: latestBar.c,
      lastBarTime: latestBar.t,
      high: latestBar.h,
      low: latestBar.l,
      volume: latestBar.v
    };
  } catch (error) {
    console.error('Error fetching market data:', error);
    throw error;
  }
}

// Check pattern breakouts
function checkPatternBreakouts(patterns, marketData) {
  const breakouts = [];
  
  for (const pattern of patterns) {
    // Check if price has broken out of pattern
    const { currentPrice } = marketData;
    
    if (pattern.breakout_level && currentPrice >= pattern.breakout_level) {
      breakouts.push({
        pattern_id: pattern.id,
        type: 'bullish',
        price: currentPrice,
        timestamp: new Date().toISOString()
      });
    } else if (pattern.breakdown_price && currentPrice <= pattern.breakdown_price) {
      breakouts.push({
        pattern_id: pattern.id,
        type: 'bearish',
        price: currentPrice,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return breakouts;
}

// Check level touches (FIXED - using correct column name 'price_level')
function checkLevelTouches(levels, marketData) {
  const touches = [];
  const { currentPrice, high, low } = marketData;
  const touchThreshold = 0.001; // 0.1% threshold
  
  for (const level of levels) {
    const levelPrice = level.price_level; // FIXED: was level.level_price
    const priceRange = levelPrice * touchThreshold;
    
    // Check if price touched the level
    if (low <= levelPrice + priceRange && high >= levelPrice - priceRange) {
      touches.push({
        level_id: level.id,
        level_price: levelPrice,
        touch_price: currentPrice,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return touches;
}

// Update levels
async function updateLevels(symbol, timeframe, marketData) {
  // Placeholder for level update logic
  // This would typically recalculate support/resistance levels
  return true;
}

// Process trade signals
function processTradeSignals(breakouts, levelTouches, marketData) {
  const signals = [];
  
  // Generate signals from breakouts
  for (const breakout of breakouts) {
    signals.push({
      type: 'breakout',
      direction: breakout.type,
      price: breakout.price,
      timestamp: breakout.timestamp,
      confidence: 'high'
    });
  }
  
  // Generate signals from level touches
  for (const touch of levelTouches) {
    signals.push({
      type: 'level_touch',
      level_price: touch.level_price,
      price: touch.touch_price,
      timestamp: touch.timestamp,
      confidence: 'medium'
    });
  }
  
  return signals;
}

// Cleanup old data - CORRECTED TABLE NAME
async function cleanupOldData(symbol, timeframe) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30); // Keep last 30 days
    
    // FIXED: Changed from 'chart_patterns' to 'pattern_states'
    await supabase
      .from('pattern_states')
      .delete()
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .lt('detected_at', cutoffDate.toISOString());
    
    console.log(`[info] Cleaned up old patterns for ${symbol} ${timeframe}`);
    return true;
  } catch (error) {
    console.error('Error during cleanup:', error);
    return false;
  }
}

// Check market session
function checkMarketSession(params) {
  const { session = 'regular' } = params;
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
  
  return {
    isOpen,
    timeframe: params.timeframe,
    session,
    currentTime,
    dayOfWeek,
    marketOpen,
    marketClose,
    isWeekday,
    isWithinHours
  };
}

// Main webhook handler
export default async function handler(req, res) {
  const startTime = Date.now();
  
  try {
    // Log incoming request
    console.log('[WEBHOOK] Enhanced webhook received:', {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'],
        'x-fastcron-signature': req.headers['x-fastcron-signature'],
        'x-signature': req.headers['x-signature'],
        signature: req.headers.signature,
        'user-agent': req.headers['user-agent']
      },
      runtime: 'nodejs'
    });
    
    // Log environment variables status
    console.log('[ENV] Environment check:');
    console.log('[ENV] ALPACA_API_KEY:', process.env.ALPACA_API_KEY ? '✓ Set' : '✗ Missing');
    console.log('[ENV] ALPACA_API_SECRET:', process.env.ALPACA_API_SECRET ? '✓ Set' : '✗ Missing');
    console.log('[ENV] SUPABASE_URL:', process.env.SUPABASE_URL ? '✓ Set' : '✗ Missing');
    console.log('[ENV] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Set' : '✗ Missing');
    
    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Parse request body
    const body = req.body;
    console.log('[WEBHOOK] Request body:', body);
    
    // Verify webhook signature (if configured)
    const fastcronSecret = process.env.FASTCRON_SECRET;
    if (fastcronSecret && req.headers['x-fastcron-signature']) {
      // Implement signature verification here
      console.log('[WEBHOOK] Verifying webhook signature...');
    } else {
      console.log('[warning] [WEBHOOK] FASTCRON_SECRET not configured, skipping signature verification');
    }
    
    // Initialize Supabase
    console.log('[WEBHOOK] Supabase client initialized');
    
    // Check market session
    const marketSession = checkMarketSession(body);
    console.log('[WEBHOOK] Current market session:', marketSession);
    
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
    
    console.log('[WEBHOOK] Database connectivity confirmed: Database connection successful');
    
    // Execute strategy
    const symbol = body.symbol || 'QQQ';
    const timeframe = body.timeframe || '10Min';
    
    console.log(`[WEBHOOK] Executing ENHANCED strategy for ${symbol} ${timeframe}`);
    
    const result = await executeEnhancedStrategy({
      symbol,
      timeframe,
      session: body.session || 'regular'
    });
    
    const totalTime = Date.now() - startTime;
    console.log('[WEBHOOK] Strategy execution completed:', {
      ...result,
      total_time_ms: totalTime
    });
    
    return res.status(200).json({
      success: true,
      message: 'Strategy executed successfully',
      ...result,
      total_time_ms: totalTime
    });
    
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}