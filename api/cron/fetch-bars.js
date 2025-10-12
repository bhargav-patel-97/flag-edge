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

    console.log('Fetching latest 1-minute bars...');
    // Fetch latest 1-minute bars
    const fetchResult = await fetcher.fetchLatestBars(['QQQ']);
    console.log('Fetch result:', fetchResult);

    // Give a small delay to ensure data is written
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Starting aggregation process...');
    
    // Aggregate to different timeframes with error handling for each
    const aggregationResults = {};
    
    try {
      const aggregation2m = await aggregator.aggregateToTimeframe('QQQ', '2m', 30);
      aggregationResults['2m'] = aggregation2m.length;
      console.log(`2m aggregation: ${aggregation2m.length} bars`);
    } catch (error) {
      console.error('2m aggregation failed:', error);
      aggregationResults['2m'] = `Error: ${error.message}`;
    }
    
    try {
      const aggregation5m = await aggregator.aggregateToTimeframe('QQQ', '5m', 60);
      aggregationResults['5m'] = aggregation5m.length;
      console.log(`5m aggregation: ${aggregation5m.length} bars`);
    } catch (error) {
      console.error('5m aggregation failed:', error);
      aggregationResults['5m'] = `Error: ${error.message}`;
    }
    
    try {
      const aggregation10m = await aggregator.aggregateToTimeframe('QQQ', '10m', 120);
      aggregationResults['10m'] = aggregation10m.length;
      console.log(`10m aggregation: ${aggregation10m.length} bars`);
    } catch (error) {
      console.error('10m aggregation failed:', error);
      aggregationResults['10m'] = `Error: ${error.message}`;
    }

    const result = {
      success: true, 
      message: 'Bars fetched and aggregated successfully',
      timestamp: new Date().toISOString(),
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
