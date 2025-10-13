import { DataFetcher } from '../../lib/data-fetcher.js';
import { BarAggregator } from '../../lib/bar-aggregator.js';

export default async function handler(req, res) {
  console.log('Starting fetch-bars cron job');

  try {
    // Check if required environment variables are present
    if (!process.env.SUPABASE_URL) {
      throw new Error('Missing required environment variable: SUPABASE_URL');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Missing required Supabase keys: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
    }
    if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
      throw new Error('Missing required Alpaca environment variables: ALPACA_API_KEY and ALPACA_SECRET_KEY');
    }

    // Log which key type we're using
    const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon';
    console.log(`Using Supabase ${keyType} key`);

    const fetcher = new DataFetcher();
    const aggregator = new BarAggregator();

    // Test database connectivity first
    console.log('Testing database connectivity...');
    const connectionTest = await fetcher.testConnection();
    if (!connectionTest.success) {
      throw new Error(`Database connection failed: ${connectionTest.error}`);
    }
    console.log('Database connectivity confirmed');

    // Determine current market session and required timeframes
    const marketSession = getCurrentMarketSession();
    console.log('Current market session:', marketSession);

    console.log('Fetching latest 1-minute bars...');
    // Fetch latest 1-minute bars
    const fetchResult = await fetcher.fetchLatestBars(['QQQ']);
    console.log('Fetch result:', fetchResult);

    // Give a small delay to ensure data is written
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Starting aggregation process...');

    // Aggregate based on current time and requirements
    const aggregationResults = {};

    if (marketSession.isOpen) {
      // Always aggregate based on what timeframes we need
      const timeframesToAggregate = getRequiredTimeframes(marketSession);

      for (const timeframeConfig of timeframesToAggregate) {
        try {
          console.log(`Aggregating ${timeframeConfig.timeframe} bars (lookback: ${timeframeConfig.lookback} minutes)`);
          const aggregation = await aggregator.aggregateToTimeframe(
            'QQQ', 
            timeframeConfig.timeframe, 
            timeframeConfig.lookback
          );
          aggregationResults[timeframeConfig.timeframe] = aggregation.length;
          console.log(`${timeframeConfig.timeframe} aggregation: ${aggregation.length} bars`);
        } catch (error) {
          console.error(`${timeframeConfig.timeframe} aggregation failed:`, error);
          aggregationResults[timeframeConfig.timeframe] = `Error: ${error.message}`;
        }
      }
    } else {
      console.log('Market is closed, skipping time-specific aggregations');

      // Still do basic aggregations for historical data
      try {
        const aggregation2m = await aggregator.aggregateToTimeframe('QQQ', '2m', 60);
        aggregationResults['2m'] = aggregation2m.length;
        console.log(`2m aggregation: ${aggregation2m.length} bars`);
      } catch (error) {
        console.error('2m aggregation failed:', error);
        aggregationResults['2m'] = `Error: ${error.message}`;
      }

      try {
        const aggregation5m = await aggregator.aggregateToTimeframe('QQQ', '5m', 120);
        aggregationResults['5m'] = aggregation5m.length;
        console.log(`5m aggregation: ${aggregation5m.length} bars`);
      } catch (error) {
        console.error('5m aggregation failed:', error);
        aggregationResults['5m'] = `Error: ${error.message}`;
      }

      try {
        const aggregation10m = await aggregator.aggregateToTimeframe('QQQ', '10m', 240);
        aggregationResults['10m'] = aggregation10m.length;
        console.log(`10m aggregation: ${aggregation10m.length} bars`);
      } catch (error) {
        console.error('10m aggregation failed:', error);
        aggregationResults['10m'] = `Error: ${error.message}`;
      }
    }

    const result = {
      success: true, 
      message: 'Bars fetched and aggregated successfully',
      timestamp: new Date().toISOString(),
      market_session: marketSession,
      environment: {
        supabase_key_type: keyType,
        node_env: process.env.NODE_ENV || 'unknown'
      },
      details: {
        fetched_symbols: Object.keys(fetchResult.bars || {}),
        fetched_bars_count: Object.keys(fetchResult.bars || {}).length,
        aggregations: aggregationResults
      }
    };

    console.log('Cron job completed successfully:', result);
    res.status(200).json(result);

  } catch (error) {
    console.error('Cron job error:', error);

    const errorResponse = {
      success: false, 
      error: error.message,
      error_code: error.code || 'UNKNOWN',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      environment: {
        has_service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        has_anon_key: !!process.env.SUPABASE_ANON_KEY,
        has_supabase_url: !!process.env.SUPABASE_URL,
        has_alpaca_keys: !!(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY)
      }
    };

    res.status(500).json(errorResponse);
  }
}

function getCurrentMarketSession() {
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
    return { 
      isOpen: false, 
      timeframe: null,
      session: 'closed',
      currentTime: `${hour}:${minute.toString().padStart(2, '0')}`,
      dayOfWeek
    };
  }

  // Determine timeframe based on time
  let timeframe, session;
  if (currentTime < firstSession) {
    timeframe = "2m"; // 9:30-10:00 AM
    session = "opening";
  } else if (currentTime < secondSession) {
    timeframe = "5m"; // 10:00-11:00 AM
    session = "morning";
  } else {
    timeframe = "10m"; // 11:00 AM-4:30 PM
    session = "regular";
  }

  return {
    isOpen: true,
    timeframe,
    session,
    currentTime: `${hour}:${minute.toString().padStart(2, '0')}`,
    dayOfWeek,
    marketOpen: "09:30",
    marketClose: "16:00"
  };
}

function getRequiredTimeframes(marketSession) {
  const timeframes = [];

  if (!marketSession.isOpen) {
    return timeframes;
  }

  switch (marketSession.session) {
    case 'opening': // 9:30-10:00 AM - Need 2min bars
      timeframes.push({
        timeframe: '2m',
        lookback: 60, // Look back 1 hour to get enough data
        priority: 'high'
      });
      break;

    case 'morning': // 10:00-11:00 AM - Need 5min bars
      timeframes.push({
        timeframe: '5m',
        lookback: 120, // Look back 2 hours
        priority: 'high'
      });
      // Also maintain 2min for historical reference
      timeframes.push({
        timeframe: '2m',
        lookback: 60,
        priority: 'low'
      });
      break;

    case 'regular': // 11:00 AM-4:30 PM - Need 10min bars
      timeframes.push({
        timeframe: '10m',
        lookback: 240, // Look back 4 hours
        priority: 'high'
      });
      // Also maintain other timeframes for reference
      timeframes.push({
        timeframe: '5m',
        lookback: 120,
        priority: 'low'
      });
      timeframes.push({
        timeframe: '2m',
        lookback: 60,
        priority: 'low'
      });
      break;

    default:
      // Fallback - aggregate all timeframes
      timeframes.push(
        { timeframe: '2m', lookback: 60, priority: 'medium' },
        { timeframe: '5m', lookback: 120, priority: 'medium' },
        { timeframe: '10m', lookback: 240, priority: 'medium' }
      );
  }

  return timeframes;
}