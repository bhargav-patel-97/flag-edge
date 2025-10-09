// api/execute-strategy.js
import { createClient } from '@supabase/supabase-js';
import { LevelDetector } from '../lib/level-detector.js';
import { FlagDetector } from '../lib/flag-detector.js';
import { OptionSelector } from '../lib/option-selector.js';
import { RiskManager } from '../lib/risk-manager.js';
import { alpacaClient } from '../lib/alpaca-client.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { timeframe, session } = req.body;
  
  try {
    // Check if trading should be paused due to economic events
    const { data: events } = await supabase
      .from('economic_events')
      .select('*')
      .eq('trading_pause', true)
      .gte('event_date', new Date().toISOString())
      .lte('event_date', new Date(Date.now() + 3600000).toISOString());

    if (events && events.length > 0) {
      return res.json({ 
        status: 'paused', 
        reason: 'Economic event detected',
        event: events[0].event_name 
      });
    }

    // Fetch latest market data from Alpaca
    const bars = await alpacaClient.getBars({
      symbols: ['QQQ'],
      timeframe: determineAlpacaTimeframe(timeframe),
      limit: 500
    });

    if (!bars || !bars.QQQ) {
      throw new Error('Failed to fetch market data');
    }

    // Calculate moving averages
    const marketData = bars.QQQ.map((bar, index) => ({
      ...bar,
      ma200: calculateMA(bars.QQQ.slice(Math.max(0, index - 199), index + 1), 200),
      ma400: calculateMA(bars.QQQ.slice(Math.max(0, index - 399), index + 1), 400)
    }));

    // Store market data in Supabase
    await storeMarketData(marketData, timeframe);

    // Detect levels using 200MA and 400MA
    const levelDetector = new LevelDetector(
      marketData.map(d => d.ma200),
      marketData.map(d => d.ma400)
    );
    const levels = levelDetector.detectLevels(marketData);

    // Store detected levels
    await storeLevels(levels);

    // Detect flag patterns
    const flagDetector = new FlagDetector();
    const flagPattern = flagDetector.detectFlag(marketData, levels);

    if (flagPattern) {
      // Store pattern detection
      await storePattern(flagPattern);

      // Check if we should enter a trade
      const riskManager = new RiskManager();
      if (await riskManager.shouldTrade()) {
        const optionSelector = new OptionSelector();
        const selectedOption = await optionSelector.selectOptimalOption(
          'QQQ',
          flagPattern.direction,
          await riskManager.calculatePositionSize()
        );

        if (selectedOption) {
          const trade = await executeTrade(selectedOption, flagPattern);
          await storeTrade(trade);
          
          return res.json({
            status: 'trade_executed',
            trade: trade,
            pattern: flagPattern
          });
        }
      }
    }

    res.json({
      status: 'analyzed',
      pattern: flagPattern,
      levels: levels.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Strategy execution error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function storeMarketData(data, timeframe) {
  const { error } = await supabase.from('market_data').insert(
    data.map(bar => ({
      symbol: 'QQQ',
      timeframe: timeframe,
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      ma200: bar.ma200,
      ma400: bar.ma400
    }))
  );
  
  if (error) throw error;
}
