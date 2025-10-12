import { DataFetcher } from '../../lib/data-fetcher.js';
import { BarAggregator } from '../../lib/bar-aggregator.js';

export default async function handler(req, res) {
  try {
    const fetcher = new DataFetcher();
    const aggregator = new BarAggregator();

    // Fetch latest 1-minute bars
    await fetcher.fetchLatestBars(['QQQ']);

    // Aggregate to different timeframes
    await aggregator.aggregateToTimeframe('QQQ', '2m');
    await aggregator.aggregateToTimeframe('QQQ', '5m');
    await aggregator.aggregateToTimeframe('QQQ', '10m');

    res.status(200).json({ 
      success: true, 
      message: 'Bars fetched and aggregated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cron job error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}