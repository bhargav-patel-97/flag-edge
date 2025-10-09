// api/execute-strategy.js
import { createClient } from '@supabase/supabase-js';
import Alpaca from '@alpacahq/alpaca-trade-api';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Initialize Alpaca client  
const alpaca = new Alpaca({
  key: process.env.ALPACA_API_KEY,
  secret: process.env.ALPACA_SECRET_KEY,
  paper: process.env.PAPER_TRADING === 'true',
  usePolygon: false
});

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  
  try {
    const { timeframe = '5min', session = 'regular' } = req.body;
    
    console.log(`[${new Date().toISOString()}] Starting strategy execution - Timeframe: ${timeframe}, Session: ${session}`);

    // Step 1: Check if trading should be paused due to economic events
    const { data: events, error: eventsError } = await supabase
      .from('economic_events')
      .select('*')
      .eq('trading_pause', true)
      .gte('event_date', new Date().toISOString())
      .lte('event_date', new Date(Date.now() + 3600000).toISOString());

    if (eventsError) {
      console.error('Error fetching economic events:', eventsError);
    }

    if (events && events.length > 0) {
      console.log('Trading paused due to economic events:', events.map(e => e.event_name));
      return res.json({ 
        status: 'paused', 
        reason: 'Economic event detected',
        events: events.map(e => e.event_name),
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Check market hours
    const now = new Date();
    const marketOpen = new Date();
    marketOpen.setHours(9, 30, 0, 0); // 9:30 AM ET
    const marketClose = new Date();
    marketClose.setHours(16, 0, 0, 0); // 4:00 PM ET
    
    const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
    const isMarketHours = now >= marketOpen && now <= marketClose;
    
    if (!isWeekday || !isMarketHours) {
      return res.json({
        status: 'market_closed',
        message: 'Market is currently closed',
        timestamp: new Date().toISOString()
      });
    }

    // Step 3: Fetch latest market data from Alpaca
    const timeframeMap = {
      '2min': '2Min',
      '5min': '5Min', 
      '10min': '10Min'
    };
    
    const alpacaTimeframe = timeframeMap[timeframe] || '5Min';
    
    console.log(`Fetching market data for QQQ with timeframe: ${alpacaTimeframe}`);
    
    const bars = await alpaca.getBarsV2('QQQ', {
      timeframe: alpacaTimeframe,
      limit: 500,
      asof: new Date().toISOString()
    });

    const barData = [];
    for await (let bar of bars) {
      barData.push({
        timestamp: bar.Timestamp,
        open: parseFloat(bar.OpenPrice),
        high: parseFloat(bar.HighPrice),
        low: parseFloat(bar.LowPrice),
        close: parseFloat(bar.ClosePrice),
        volume: parseInt(bar.Volume)
      });
    }

    if (barData.length === 0) {
      throw new Error('No market data received from Alpaca');
    }

    console.log(`Received ${barData.length} bars of market data`);

    // Step 4: Calculate moving averages
    const marketData = calculateMovingAverages(barData);
    
    // Step 5: Store market data in Supabase
    try {
      const { error: insertError } = await supabase
        .from('market_data')
        .insert(marketData.slice(-1).map(bar => ({
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
        })));
      
      if (insertError) {
        console.error('Error storing market data:', insertError);
      } else {
        console.log('Market data stored successfully');
      }
    } catch (storageError) {
      console.error('Storage error:', storageError);
    }

    // Step 6: Detect levels using 200MA and 400MA
    const levels = detectLevels(marketData);
    console.log(`Detected ${levels.length} levels`);

    // Step 7: Store detected levels
    if (levels.length > 0) {
      try {
        // Clear old levels first
        await supabase.from('levels').delete().eq('symbol', 'QQQ');
        
        // Insert new levels
        const { error: levelsError } = await supabase
          .from('levels')
          .insert(levels.map(level => ({
            symbol: 'QQQ',
            level_type: level.type,
            price: level.value,
            strength: level.strength === 'high' ? 3 : level.strength === 'medium' ? 2 : 1,
            touches: level.touches || 1
          })));
        
        if (levelsError) {
          console.error('Error storing levels:', levelsError);
        } else {
          console.log('Levels stored successfully');
        }
      } catch (levelsStorageError) {
        console.error('Levels storage error:', levelsStorageError);
      }
    }

    // Step 8: Detect flag patterns
    const flagPattern = detectFlagPattern(marketData, levels);
    
    if (flagPattern) {
      console.log('Flag pattern detected:', flagPattern);
      
      // Store pattern detection
      try {
        const { error: patternError } = await supabase
          .from('flag_patterns')
          .insert({
            symbol: 'QQQ',
            pattern_type: 'flag',
            direction: flagPattern.direction,
            breakout_level: flagPattern.breakoutLevel,
            confidence_score: flagPattern.confidence,
            timeframe: timeframe
          });
        
        if (patternError) {
          console.error('Error storing pattern:', patternError);
        }
      } catch (patternStorageError) {
        console.error('Pattern storage error:', patternStorageError);
      }

      // Step 9: Risk management check
      const riskCheck = await performRiskCheck();
      
      if (riskCheck.canTrade) {
        console.log('Risk check passed, attempting to execute trade');
        
        // For now, just log the trade opportunity
        // In production, you would execute the actual trade here
        const tradeOpportunity = {
          symbol: 'QQQ',
          pattern: flagPattern,
          action: flagPattern.direction === 'bullish' ? 'BUY_CALL' : 'BUY_PUT',
          confidence: flagPattern.confidence,
          levels: levels
        };
        
        console.log('Trade opportunity identified:', tradeOpportunity);
        
        return res.json({
          status: 'trade_opportunity',
          trade: tradeOpportunity,
          pattern: flagPattern,
          levels: levels,
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('Risk check failed:', riskCheck.reason);
        return res.json({
          status: 'risk_check_failed',
          reason: riskCheck.reason,
          pattern: flagPattern,
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        });
      }
    }

    // No pattern found
    console.log('No flag pattern detected');
    
    res.json({
      status: 'analyzed',
      pattern: null,
      levels: levels.length,
      market_data_points: marketData.length,
      execution_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Strategy execution error:', error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      execution_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
  }
}

// Helper Functions

function calculateMovingAverages(bars) {
  return bars.map((bar, index) => {
    const ma200 = calculateMA(bars, index, 200);
    const ma400 = calculateMA(bars, index, 400);
    
    return {
      ...bar,
      ma200,
      ma400
    };
  });
}

function calculateMA(bars, currentIndex, period) {
  if (currentIndex < period - 1) return null;
  
  const start = Math.max(0, currentIndex - period + 1);
  const slice = bars.slice(start, currentIndex + 1);
  const sum = slice.reduce((acc, bar) => acc + bar.close, 0);
  
  return sum / slice.length;
}

function detectLevels(marketData) {
  const levels = [];
  const currentData = marketData[marketData.length - 1];
  
  // Add MA-based levels
  if (currentData.ma200) {
    levels.push({
      type: 'ma200',
      value: currentData.ma200,
      strength: 'high',
      source: 'moving_average'
    });
  }
  
  if (currentData.ma400) {
    levels.push({
      type: 'ma400', 
      value: currentData.ma400,
      strength: 'high',
      source: 'moving_average'
    });
  }

  // Simple pivot-based support/resistance detection
  const recentBars = marketData.slice(-50); // Last 50 bars
  const pivots = findPivotPoints(recentBars);
  const clusters = clusterPivots(pivots);
  
  levels.push(...clusters);
  
  return levels;
}

function findPivotPoints(bars, lookback = 5) {
  const pivots = [];
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const current = bars[i];
    const leftBars = bars.slice(i - lookback, i);
    const rightBars = bars.slice(i + 1, i + lookback + 1);
    
    // Pivot high
    if (leftBars.every(bar => bar.high <= current.high) &&
        rightBars.every(bar => bar.high <= current.high)) {
      pivots.push({
        type: 'resistance',
        value: current.high,
        timestamp: current.timestamp,
        volume: current.volume
      });
    }
    
    // Pivot low  
    if (leftBars.every(bar => bar.low >= current.low) &&
        rightBars.every(bar => bar.low >= current.low)) {
      pivots.push({
        type: 'support',
        value: current.low,
        timestamp: current.timestamp,
        volume: current.volume
      });
    }
  }
  
  return pivots;
}

function clusterPivots(pivots) {
  const clusters = [];
  const processed = new Set();
  const proximityThreshold = 0.1; // 0.1% price proximity
  
  for (let i = 0; i < pivots.length; i++) {
    if (processed.has(i)) continue;
    
    const pivot = pivots[i];
    const cluster = [pivot];
    processed.add(i);
    
    // Find nearby pivots
    for (let j = i + 1; j < pivots.length; j++) {
      if (processed.has(j)) continue;
      
      const other = pivots[j];
      const priceDiff = Math.abs(pivot.value - other.value);
      const pricePercent = (priceDiff / pivot.value) * 100;
      
      if (pricePercent <= proximityThreshold && pivot.type === other.type) {
        cluster.push(other);
        processed.add(j);
      }
    }
    
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((sum, p) => sum + p.value, 0) / cluster.length;
      
      clusters.push({
        type: pivot.type,
        value: avgPrice,
        strength: cluster.length > 3 ? 'high' : 'medium',
        touches: cluster.length,
        source: 'pivot_cluster'
      });
    }
  }
  
  return clusters;
}

function detectFlagPattern(marketData, levels) {
  if (marketData.length < 30) return null;
  
  const recentBars = marketData.slice(-20); // Last 20 bars
  const previousBars = marketData.slice(-50, -20); // Previous 30 bars
  
  // Check for big move in previous bars
  const bigMove = hasBigMove(previousBars);
  if (!bigMove) return null;
  
  // Check for consolidation in recent bars
  const consolidation = isConsolidating(recentBars);
  if (!consolidation) return null;
  
  // Check confluence with levels
  const confluence = hasConfluence(recentBars, levels);
  
  const confidence = calculatePatternConfidence(bigMove, consolidation, confluence);
  
  if (confidence < 0.6) return null; // Minimum confidence threshold
  
  return {
    pattern: 'flag',
    direction: bigMove.direction,
    breakoutLevel: calculateBreakoutLevel(recentBars, bigMove.direction),
    confidence: confidence,
    bigMove: bigMove,
    consolidation: consolidation,
    confluence: confluence
  };
}

function hasBigMove(bars) {
  if (bars.length < 10) return null;
  
  const startPrice = bars[0].close;
  const endPrice = bars[bars.length - 1].close;
  const movePercent = Math.abs((endPrice - startPrice) / startPrice) * 100;
  
  if (movePercent < 1.5) return null; // Minimum 1.5% move
  
  const direction = endPrice > startPrice ? 'bullish' : 'bearish';
  
  return {
    direction,
    movePercent,
    startPrice,
    endPrice
  };
}

function isConsolidating(bars) {
  if (bars.length < 10) return null;
  
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  
  const consolidationRange = ((highestHigh - lowestLow) / lowestLow) * 100;
  
  // Consolidation should be less than 2% range
  if (consolidationRange > 2.0) return null;
  
  return {
    range: consolidationRange,
    highestHigh,
    lowestLow
  };
}

function hasConfluence(bars, levels) {
  const currentPrice = bars[bars.length - 1].close;
  const confluenceThreshold = 0.5; // 0.5% proximity to level
  
  const nearbyLevels = levels.filter(level => {
    const distance = Math.abs(currentPrice - level.value);
    const distancePercent = (distance / currentPrice) * 100;
    return distancePercent <= confluenceThreshold;
  });
  
  return {
    hasConfluence: nearbyLevels.length > 0,
    nearbyLevels: nearbyLevels,
    count: nearbyLevels.length
  };
}

function calculatePatternConfidence(bigMove, consolidation, confluence) {
  let confidence = 0.4; // Base confidence
  
  // Big move strength
  if (bigMove.movePercent > 3.0) confidence += 0.2;
  else if (bigMove.movePercent > 2.0) confidence += 0.1;
  
  // Consolidation tightness
  if (consolidation.range < 1.0) confidence += 0.2;
  else if (consolidation.range < 1.5) confidence += 0.1;
  
  // Confluence bonus
  if (confluence.hasConfluence) {
    confidence += confluence.count * 0.1;
  }
  
  return Math.min(confidence, 1.0); // Cap at 1.0
}

function calculateBreakoutLevel(bars, direction) {
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  
  if (direction === 'bullish') {
    return Math.max(...highs) + 0.01; // Breakout above highest high
  } else {
    return Math.min(...lows) - 0.01; // Breakout below lowest low  
  }
}

async function performRiskCheck() {
  try {
    // Get current portfolio value
    const account = await alpaca.getAccount();
    const portfolioValue = parseFloat(account.portfolio_value);
    
    // Get today's P&L
    const portfolioHistory = await alpaca.getPortfolioHistory({
      period: '1D',
      timeframe: '1Min'
    });
    
    const todayPnL = portfolioHistory.profit_loss[portfolioHistory.profit_loss.length - 1] || 0;
    const dailyLossPercent = (todayPnL / portfolioValue) * 100;
    
    const maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS || '2.0');
    
    if (Math.abs(dailyLossPercent) >= maxDailyLoss) {
      return {
        canTrade: false,
        reason: `Daily loss limit reached: ${dailyLossPercent.toFixed(2)}%`
      };
    }
    
    // Check position count
    const positions = await alpaca.getPositions();
    if (positions.length >= 5) { // Max 5 positions
      return {
        canTrade: false,
        reason: 'Maximum position count reached'
      };
    }
    
    return {
      canTrade: true,
      portfolioValue,
      dailyPnL: todayPnL,
      positionCount: positions.length
    };
    
  } catch (error) {
    console.error('Risk check error:', error);
    return {
      canTrade: false,
      reason: 'Risk check failed due to error'
    };
  }
}