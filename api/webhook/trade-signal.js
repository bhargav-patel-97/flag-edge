// api/webhook/trade-signal.js
// Enhanced webhook endpoint - Compatible with both Node.js and Edge runtimes
// Fixed to work with standard Supabase client exports

import { createClient } from '@supabase/supabase-js';
import { executeEnhancedStrategy } from '../../lib/level-flag-strategy.js';

export default async function handler(req, res) {
  const startTime = Date.now();
  
  // Helper function to get headers (works with both runtime types)
  const getHeader = (headerName) => {
    if (req.headers && typeof req.headers.get === 'function') {
      // Edge runtime
      return req.headers.get(headerName);
    } else if (req.headers && typeof req.headers === 'object') {
      // Node.js runtime
      return req.headers[headerName] || req.headers[headerName.toLowerCase()];
    }
    return undefined;
  };

  console.log('[WEBHOOK] Enhanced webhook received:', {
    method: req.method,
    headers: {
      'content-type': getHeader('content-type'),
      'x-fastcron-signature': getHeader('x-fastcron-signature') || undefined,
      'x-signature': getHeader('x-signature') || undefined,
      'signature': getHeader('signature') || undefined,
      'user-agent': getHeader('user-agent')
    },
    runtime: req.headers && typeof req.headers.get === 'function' ? 'edge' : 'nodejs'
  });

  if (req.method !== 'POST') {
    const errorResponse = { error: 'Method not allowed' };
    
    if (res) {
      return res.status(405).json(errorResponse);
    } else {
      return new Response(JSON.stringify(errorResponse), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    // Parse request body (compatible with both runtimes)
    let body;
    const contentType = getHeader('content-type');
    
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (req.json && typeof req.json === 'function') {
      try {
        body = await req.json();
      } catch (e) {
        body = { timeframe: '10Min', session: 'regular' };
      }
    } else if (req.text && typeof req.text === 'function') {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { timeframe: '10Min', session: 'regular' };
      }
    } else {
      body = { timeframe: '10Min', session: 'regular' };
    }

    console.log('[WEBHOOK] Request body:', body);

    // Extract parameters
    const timeframe = body.timeframe || '10Min';
    const session = body.session || 'regular';
    const force = body.force || false;
    const symbol = body.symbol || 'QQQ';
    const mode = body.mode || 'enhanced';

    // Verify webhook signature if configured
    const signature = getHeader('x-fastcron-signature') || 
                     getHeader('x-signature') || 
                     getHeader('signature');

    if (process.env.FASTCRON_SECRET && signature) {
      try {
        const { verifyWebhookSignature } = await import('../../lib/security.js');
        const isValidSignature = verifyWebhookSignature(
          JSON.stringify(body),
          signature,
          process.env.FASTCRON_SECRET
        );
        
        if (!isValidSignature) {
          console.error('[WEBHOOK] Invalid webhook signature');
          const errorResponse = { error: 'Invalid signature' };
          
          if (res) {
            return res.status(401).json(errorResponse);
          } else {
            return new Response(JSON.stringify(errorResponse), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
        console.log('[WEBHOOK] Webhook signature verified successfully');
      } catch (secErr) {
        console.warn('[WEBHOOK] Error verifying signature:', secErr.message);
      }
    } else {
      console.warn('[WEBHOOK] FASTCRON_SECRET not configured, skipping signature verification');
    }

    // Initialize Supabase client directly (not using getInstance)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[WEBHOOK] Missing Supabase credentials');
      const errorResponse = {
        success: false,
        error: 'Supabase configuration missing',
        execution_time_ms: Date.now() - startTime
      };
      
      if (res) {
        return res.status(500).json(errorResponse);
      } else {
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    console.log('[WEBHOOK] Supabase client initialized');

    // Check market session
    const marketSession = getMarketSession(timeframe, session);
    console.log('[WEBHOOK] Current market session:', marketSession);

    if (!marketSession.isOpen && !force) {
      console.log('[WEBHOOK] Market is closed, skipping execution');
      const response = {
        success: true,
        message: 'Market closed, execution skipped',
        market_session: marketSession,
        execution_time_ms: Date.now() - startTime
      };
      
      if (res) {
        return res.status(200).json(response);
      } else {
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Test database connectivity
    console.log('[WEBHOOK] Testing database connectivity...');
    const dbTest = await testDatabaseConnection(supabase);
    
    if (!dbTest.success) {
      console.error('[WEBHOOK] Database connection failed:', dbTest.error);
      const errorResponse = {
        success: false,
        error: 'Database connection failed',
        details: dbTest.error,
        execution_time_ms: Date.now() - startTime
      };
      
      if (res) {
        return res.status(500).json(errorResponse);
      } else {
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    console.log('[WEBHOOK] Database connectivity confirmed:', dbTest.message);

    // Execute strategy based on mode
    let result;
    
    if (mode === 'enhanced') {
      console.log(`[WEBHOOK] Executing ENHANCED strategy for ${symbol} ${timeframe}`);
      
      const strategyOptions = {
        force,
        limit: body.limit || 100,
        skipNewPatternDetection: body.skipNewPatternDetection || false,
        legacyLevels: body.legacyLevels
      };
      
      result = await executeEnhancedStrategy(symbol, timeframe, supabase, strategyOptions);
      
    } else {
      console.log(`[WEBHOOK] Executing LEGACY strategy for ${symbol} ${timeframe}`);
      
      try {
        const { executeLevelFlagStrategy } = await import('../../lib/level-flag-strategy.js');
        result = await executeLevelFlagStrategy(symbol, timeframe, supabase, { force });
      } catch (importErr) {
        console.warn('[WEBHOOK] Legacy strategy not available, using enhanced:', importErr.message);
        result = await executeEnhancedStrategy(symbol, timeframe, supabase, { force });
      }
    }

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
      
      strategy_execution_time_ms: result.execution_time_ms,
      bars_processed: result.bars_processed,
      current_price: result.current_price,
      
      active_patterns_monitored: result.active_patterns_checked || 0,
      patterns_broken_out: result.patterns_broken_out || 0,
      new_patterns_detected: result.new_patterns_detected || 0,
      
      active_levels_monitored: result.active_levels_checked || 0,
      level_touches: result.level_touches || 0,
      levels_updated: result.levels_updated || 0,
      
      trade_signals_generated: result.trade_signals_generated || 0,
      
      patterns_expired: result.patterns_expired || 0,
      levels_invalidated: result.levels_invalidated || 0,
      
      error: result.error || null
    };

    if (result.success && result.breakout_signals) {
      response.breakout_details = result.breakout_signals;
      response.level_touch_details = result.level_touches_detail;
      response.new_pattern_details = result.new_patterns_detail;
    }

    // Log webhook completion
    await logWebhookExecution(supabase, response, body);

    const statusCode = result.success ? 200 : 500;
    
    if (res) {
      return res.status(statusCode).json(response);
    } else {
      return new Response(JSON.stringify(response), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('[WEBHOOK] Webhook execution failed:', error);
    console.error('[WEBHOOK] Error stack:', error.stack);
    
    const errorResponse = {
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      total_execution_time_ms: Date.now() - startTime
    };

    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
        await logWebhookError(supabase, errorResponse);
      }
    } catch (logErr) {
      console.error('[WEBHOOK] Failed to log error:', logErr);
    }

    if (res) {
      return res.status(500).json(errorResponse);
    } else {
      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

/**
 * Get market session information
 */
function getMarketSession(timeframe, session) {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);
  const dayOfWeek = now.getDay();
  
  const marketOpen = '09:30';
  const marketClose = '16:00';
  
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
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
    const { data, error } = await supabase
      .from('aggregated_bars')
      .select('count')
      .limit(1);

    if (error) {
      return {
        success: false,
        error: error.message,
        keyType: 'service_role'
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
async function logWebhookExecution(supabase, executionData, requestBody) {
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
          market_session: executionData.market_session,
          request_body: requestBody
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
          stack: errorData.stack,
          execution_time_ms: errorData.total_execution_time_ms
        }
      });
  } catch (err) {
    console.error('[WEBHOOK] Error logging webhook error:', err);
  }
}