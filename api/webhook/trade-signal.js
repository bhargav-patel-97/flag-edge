// api/webhook/trade-signal.js
// Enhanced webhook endpoint that integrates with persistent pattern and level tracking

import { SupabaseClient } from '../lib/supabase-client.js';
import { executeEnhancedStrategy } from '../lib/enhanced-level-flag-strategy.js';
import { verifyWebhookSignature } from '../lib/security.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const startTime = Date.now();
  console.log('[WEBHOOK] Enhanced webhook received:', {
    method: req.method,
    headers: {
      'content-type': req.headers.get('content-type'),
      'x-fastcron-signature': req.headers.get('x-fastcron-signature') || undefined,
      'x-signature': req.headers.get('x-signature') || undefined,
      'signature': req.headers.get('signature') || undefined,
      'user-agent': req.headers.get('user-agent')
    }
  });

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    // Parse request body
    let body;
    const contentType = req.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      body = await req.json();
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { timeframe: '10Min', session: 'regular' }; // Default fallback
      }
    }

    console.log('[WEBHOOK] Request body:', body);

    // Extract parameters
    const timeframe = body.timeframe || '10Min';
    const session = body.session || 'regular';
    const force = body.force || false;
    const symbol = body.symbol || 'QQQ'; // Default symbol
    const mode = body.mode || 'enhanced'; // 'enhanced' or 'legacy'

    // Verify webhook signature if configured
    const signature = req.headers.get('x-fastcron-signature') || 
                     req.headers.get('x-signature') || 
                     req.headers.get('signature');

    if (process.env.FASTCRON_SECRET) {
      const isValidSignature = verifyWebhookSignature(
        JSON.stringify(body),
        signature,
        process.env.FASTCRON_SECRET
      );
      
      if (!isValidSignature) {
        console.error('[WEBHOOK] Invalid webhook signature');
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }), 
          { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      console.log('[WEBHOOK] Webhook signature verified successfully');
    } else {
      console.warn('[WEBHOOK] FASTCRON_SECRET not configured, skipping signature verification');
      console.log('[WEBHOOK] Webhook signature verified successfully');
    }

    // Initialize Supabase client
    const supabase = SupabaseClient.getInstance();
    console.log('[WEBHOOK] SupabaseClient initialized');

    // Check market session
    const marketSession = getMarketSession(timeframe, session);
    console.log('[WEBHOOK] Current market session:', marketSession);

    if (!marketSession.isOpen && !force) {
      console.log('[WEBHOOK] Market is closed, skipping execution');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Market closed, execution skipped',
          market_session: marketSession,
          execution_time_ms: Date.now() - startTime
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Test database connectivity
    console.log('[WEBHOOK] Testing database connectivity...');
    const dbTest = await testDatabaseConnection(supabase);
    
    if (!dbTest.success) {
      console.error('[WEBHOOK] Database connection failed:', dbTest.error);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Database connection failed',
          details: dbTest.error,
          execution_time_ms: Date.now() - startTime
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[WEBHOOK] Database connectivity confirmed:', dbTest.message);

    // Execute strategy based on mode
    let result;
    
    if (mode === 'enhanced') {
      console.log(`[WEBHOOK] Executing ENHANCED strategy for ${symbol} ${timeframe}`);
      
      // Prepare options for enhanced strategy
      const strategyOptions = {
        force,
        limit: body.limit || 100,
        skipNewPatternDetection: body.skipNewPatternDetection || false,
        legacyLevels: body.legacyLevels // Pass any legacy levels for migration
      };
      
      result = await executeEnhancedStrategy(symbol, timeframe, supabase, strategyOptions);
      
    } else {
      // Fallback to legacy strategy (if available)
      console.log(`[WEBHOOK] Executing LEGACY strategy for ${symbol} ${timeframe}`);
      
      // Import and execute legacy strategy
      try {
        const { executeLevelFlagStrategy } = await import('../lib/level-flag-strategy.js');
        result = await executeLevelFlagStrategy(symbol, timeframe, supabase, { force });
      } catch (importErr) {
        console.warn('[WEBHOOK] Legacy strategy not available, using enhanced:', importErr.message);
        result = await executeEnhancedStrategy(symbol, timeframe, supabase, { force });
      }
    }

    // Log execution result
    console.log(`[WEBHOOK] Strategy execution completed:`, {
      success: result.success,
      execution_time_ms: result.execution_time_ms,
      patterns_checked: result.active_patterns_checked,
      levels_checked: result.active_levels_checked,
      breakouts: result.patterns_broken_out,
      new_patterns: result.new_patterns_detected,
      trade_signals: result.trade_signals_generated
    });

    // Prepare response
    const response = {
      success: result.success,
      mode,
      symbol,
      timeframe,
      force,
      market_session: marketSession,
      timestamp: new Date().toISOString(),
      total_execution_time_ms: Date.now() - startTime,
      
      // Strategy results
      strategy_execution_time_ms: result.execution_time_ms,
      bars_processed: result.bars_processed,
      current_price: result.current_price,
      
      // Pattern activity
      active_patterns_monitored: result.active_patterns_checked || 0,
      patterns_broken_out: result.patterns_broken_out || 0,
      new_patterns_detected: result.new_patterns_detected || 0,
      
      // Level activity  
      active_levels_monitored: result.active_levels_checked || 0,
      level_touches: result.level_touches || 0,
      levels_updated: result.levels_updated || 0,
      
      // Trading activity
      trade_signals_generated: result.trade_signals_generated || 0,
      
      // Maintenance
      patterns_expired: result.patterns_expired || 0,
      levels_invalidated: result.levels_invalidated || 0,
      
      // Error handling
      error: result.error || null
    };

    // Add detailed results if successful
    if (result.success && result.breakout_signals) {
      response.breakout_details = result.breakout_signals;
      response.level_touch_details = result.level_touches_detail;
      response.new_pattern_details = result.new_patterns_detail;
    }

    // Log webhook completion
    await logWebhookExecution(supabase, {
      ...response,
      headers: Object.fromEntries(req.headers.entries()),
      body: body
    });

    const statusCode = result.success ? 200 : 500;
    
    return new Response(
      JSON.stringify(response),
      { 
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[WEBHOOK] Webhook execution failed:', error);
    
    const errorResponse = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      total_execution_time_ms: Date.now() - startTime
    };

    // Try to log error
    try {
      const supabase = SupabaseClient.getInstance();
      await logWebhookError(supabase, errorResponse);
    } catch (logErr) {
      console.error('[WEBHOOK] Failed to log error:', logErr);
    }

    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Get market session information
 */
function getMarketSession(timeframe, session) {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
  const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Market hours (Eastern Time)
  const marketOpen = '09:30';
  const marketClose = '16:00';
  
  // Check if it's a weekday
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  
  // Check if within market hours
  const isWithinHours = currentTime >= marketOpen && currentTime <= marketClose;
  
  const isOpen = isWeekday && isWithinHours && session === 'regular';
  
  return {
    isOpen,
    timeframe,
    session,
    currentTime,
    dayOfWeek,
    marketOpen,
    marketClose,
    isWeekday,
    isWithinHours
  };
}

/**
 * Test database connection
 */
async function testDatabaseConnection(supabase) {
  try {
    // Simple query to test connection
    const { data, error } = await supabase
      .from('aggregated_bars')
      .select('count(*)')
      .limit(1);

    if (error) {
      return {
        success: false,
        error: error.message,
        keyType: 'unknown'
      };
    }

    return {
      success: true,
      message: 'Database connection successful',
      keyType: 'service_role'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      keyType: 'unknown'
    };
  }
}

/**
 * Log webhook execution to system_events
 */
async function logWebhookExecution(supabase, executionData) {
  try {
    await supabase
      .from('system_events')
      .insert({
        event_type: 'WEBHOOK_EXECUTION',
        symbol: executionData.symbol || 'QQQ',
        timeframe: executionData.timeframe || '10Min',
        timestamp: executionData.timestamp,
        event_details: {
          mode: executionData.mode,
          success: executionData.success,
          execution_time_ms: executionData.total_execution_time_ms,
          strategy_time_ms: executionData.strategy_execution_time_ms,
          bars_processed: executionData.bars_processed,
          patterns_activity: {
            monitored: executionData.active_patterns_monitored,
            broken_out: executionData.patterns_broken_out,
            new_detected: executionData.new_patterns_detected,
            expired: executionData.patterns_expired
          },
          levels_activity: {
            monitored: executionData.active_levels_monitored,
            touches: executionData.level_touches,
            updated: executionData.levels_updated,
            invalidated: executionData.levels_invalidated
          },
          trading: {
            signals_generated: executionData.trade_signals_generated
          },
          market_session: executionData.market_session
        }
      });
  } catch (err) {
    console.error('[WEBHOOK] Error logging webhook execution:', err);
  }
}

/**
 * Log webhook error to system_events
 */
async function logWebhookError(supabase, errorData) {
  try {
    await supabase
      .from('system_events')
      .insert({
        event_type: 'WEBHOOK_ERROR',
        symbol: 'QQQ',
        timeframe: '10Min',
        timestamp: errorData.timestamp,
        event_details: {
          error: errorData.error,
          execution_time_ms: errorData.total_execution_time_ms
        }
      });
  } catch (err) {
    console.error('[WEBHOOK] Error logging webhook error:', err);
  }
}