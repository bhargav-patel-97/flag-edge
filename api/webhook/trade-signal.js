import { LevelFlagStrategy } from '../../lib/level-flag-strategy.js';
import { verifyWebhookSignature } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Enhanced debugging - log request details
    console.log('Enhanced webhook received:', {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'],
        'x-fastcron-signature': req.headers['x-fastcron-signature'],
        'x-signature': req.headers['x-signature'],
        'signature': req.headers['signature'],
        'user-agent': req.headers['user-agent']
      },
      body: req.body,
      bodyType: typeof req.body
    });

    // Verify FastCron webhook signature
    const isValidSignature = verifyWebhookSignature(req);
    if (!isValidSignature) {
      console.warn('Invalid webhook signature - request rejected');
      return res.status(401).json({ 
        error: 'Unauthorized - Invalid signature',
        timestamp: new Date().toISOString()
      });
    }
    console.log('Webhook signature verified successfully');

    // Extract parameters from request body
    const { timeframe, force = false } = req.body || {};
    if (!timeframe) {
      console.warn('Missing timeframe parameter in request');
      return res.status(400).json({ 
        error: 'Missing timeframe parameter',
        expected: 'timeframe should be one of: 2Min, 5Min, 10Min',
        received: req.body
      });
    }

    // Validate timeframe and map to internal format
    const timeframeMapping = {
      '2Min': '2Min',
      '5Min': '5Min', 
      '10Min': '10Min',
      '2min': '2Min',
      '5min': '5Min',
      '10min': '10Min',
      '2m': '2Min',
      '5m': '5Min',
      '10m': '10Min'
    };

    const normalizedTimeframe = timeframeMapping[timeframe];
    if (!normalizedTimeframe) {
      console.warn(`Invalid timeframe: ${timeframe}`);
      return res.status(400).json({ 
        error: 'Invalid timeframe',
        expected: Object.keys(timeframeMapping),
        received: timeframe
      });
    }

    console.log(`Executing ENHANCED strategy for timeframe: ${normalizedTimeframe}, force: ${force}`);

    // Initialize enhanced strategy
    const strategy = new LevelFlagStrategy();

    // Get current market session to validate timing
    const marketSession = strategy.getMarketSession();
    console.log('Current market session:', marketSession);

    // Test database connectivity before executing strategy
    console.log('Testing database connectivity...');
    const dbTest = await strategy.alpaca.testDatabaseConnection();
    console.log('Database test result:', dbTest);

    if (!dbTest.success) {
      console.error('Database connectivity issue detected:', dbTest);
      return res.status(500).json({
        success: false,
        error: 'Database connectivity issue',
        details: dbTest,
        timestamp: new Date().toISOString()
      });
    }

    // Test Polygon.io connectivity (optional - don't fail if not available)
    console.log('Testing Polygon.io connectivity...');
    let polygonConnectivity = { available: false, error: null };
    try {
      // Just test if we have the API key - don't make actual request yet
      if (process.env.POLYGON_API_KEY) {
        polygonConnectivity.available = true;
        console.log('Polygon.io API key found - enhanced SMA features available');
      } else {
        console.warn('Polygon.io API key not found - will use fallback SMA calculation');
      }
    } catch (polygonError) {
      console.warn('Polygon.io connectivity test warning:', polygonError.message);
      polygonConnectivity.error = polygonError.message;
    }

    // Execute enhanced strategy based on current timeframe
    let result;
    try {
      result = await strategy.executeTimeframedStrategy(normalizedTimeframe, force);
    } catch (strategyError) {
      console.error('Enhanced strategy execution failed:', strategyError);

      const errorResponse = {
        success: false,
        error: 'Enhanced strategy execution failed',
        details: {
          message: strategyError.message,
          stack: process.env.NODE_ENV === 'development' ? strategyError.stack : undefined,
          timeframe: normalizedTimeframe,
          force: force,
          marketSession: marketSession,
          polygonConnectivity
        },
        timestamp: new Date().toISOString()
      };

      return res.status(500).json(errorResponse);
    }

    console.log('Enhanced strategy execution completed:', {
      success: result.success,
      reason: result.reason,
      tradesExecuted: result.trades?.length || 0,
      signalsGenerated: result.signals?.length || 0,
      levelsDetected: result.levels || 0,
      highConfidenceLevels: result.highConfidenceLevels || 0,
      polygonSMAUsed: result.indicatorsUsed?.polygonSMA200 || result.indicatorsUsed?.polygonSMA400,
      marketSession: {
        isOpen: marketSession.isOpen,
        currentTimeframe: marketSession.timeframe,
        session: marketSession.session
      }
    });

    // Enhanced response with more context and new features
    const responseData = {
      success: true,
      message: 'Enhanced strategy executed successfully',
      result,
      enhancements: {
        polygonSMAIntegration: polygonConnectivity.available,
        enhancedLevelDetection: true,
        improvedFlagRecognition: true,
        confluenceAnalysis: true,
        confidenceScoring: true
      },
      marketSession: {
        isOpen: marketSession.isOpen,
        currentTimeframe: marketSession.timeframe,
        session: marketSession.session,
        currentTime: marketSession.currentTime
      },
      execution: {
        requestedTimeframe: timeframe,
        normalizedTimeframe: normalizedTimeframe,
        forced: force,
        timestamp: new Date().toISOString()
      },
      debug: {
        databaseConnectivity: dbTest.success,
        keyType: dbTest.keyType || 'unknown',
        polygonConnectivity: polygonConnectivity
      }
    };

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Enhanced webhook execution error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    const errorResponse = {
      success: false,
      error: error.message,
      errorType: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      environment: {
        has_service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        has_anon_key: !!process.env.SUPABASE_ANON_KEY,
        has_supabase_url: !!process.env.SUPABASE_URL,
        has_alpaca_keys: !!(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY),
        has_polygon_key: !!process.env.POLYGON_API_KEY
      }
    };

    res.status(500).json(errorResponse);
  }
}