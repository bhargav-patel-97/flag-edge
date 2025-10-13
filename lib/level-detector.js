
export class LevelDetector {
  constructor() {
    this.tolerance = 0.002; // 0.2% tolerance for level matching
    this.minTouchCount = 2; // Minimum touches to consider a level valid
  }

  detectLevels(bars, indicators) {
    const levels = [];
    const { ma200, ma400, polygonSMA200, polygonSMA400 } = indicators;

    // Add Polygon.io long-term moving average levels (preferred if available)
    if (polygonSMA200 && polygonSMA200.value) {
      levels.push({
        type: 'ma200',
        value: polygonSMA200.value,
        strength: 'very_high', // Polygon data is more reliable for long-term MAs
        source: 'polygon_200_sma',
        timestamp: polygonSMA200.timestamp,
        confidence: 0.95
      });
    } else if (ma200 && ma200.length > 0) {
      // Fallback to local calculation
      levels.push({
        type: 'ma200',
        value: ma200[ma200.length - 1],
        strength: 'high',
        source: '200_period_ma',
        confidence: 0.85
      });
    }

    if (polygonSMA400 && polygonSMA400.value) {
      levels.push({
        type: 'ma400',
        value: polygonSMA400.value,
        strength: 'very_high',
        source: 'polygon_400_sma',
        timestamp: polygonSMA400.timestamp,
        confidence: 0.95
      });
    } else if (ma400 && ma400.length > 0) {
      // Fallback to local calculation
      levels.push({
        type: 'ma400',
        value: ma400[ma400.length - 1],
        strength: 'high',
        source: '400_period_ma',
        confidence: 0.85
      });
    }

    // Detect pivot points (support/resistance)
    const pivots = this.findPivotPoints(bars);
    levels.push(...pivots);

    // Detect volume profile levels
    const volumeLevels = this.findVolumeLevels(bars);
    levels.push(...volumeLevels);

    // Calculate regression trend lines
    const trendLines = this.calculateRegressionTrendLines(bars);
    levels.push(...trendLines);

    // Enhanced support/resistance zones with multiple touch analysis
    const supportResistanceZones = this.findSupportResistanceZones(bars);
    levels.push(...supportResistanceZones);

    // Find confluence zones
    const confluenceZones = this.findConfluenceZones(levels);

    return confluenceZones;
  }

  findPivotPoints(bars, window = 10) {
    const pivots = [];

    for (let i = window; i < bars.length - window; i++) {
      const current = bars[i];
      const leftWindow = bars.slice(i - window, i);
      const rightWindow = bars.slice(i + 1, i + window + 1);

      // Pivot high
      const isPivotHigh = leftWindow.every(bar => bar.high <= current.high) &&
                         rightWindow.every(bar => bar.high < current.high);

      // Pivot low   
      const isPivotLow = leftWindow.every(bar => bar.low >= current.low) &&
                        rightWindow.every(bar => bar.low > current.low);

      if (isPivotHigh) {
        pivots.push({
          type: 'resistance',
          value: current.high,
          strength: 'medium',
          source: 'pivot_high',
          timestamp: current.timestamp,
          touches: 1,
          confidence: 0.7
        });
      }

      if (isPivotLow) {
        pivots.push({
          type: 'support',
          value: current.low,
          strength: 'medium',
          source: 'pivot_low',
          timestamp: current.timestamp,
          touches: 1,
          confidence: 0.7
        });
      }
    }

    return this.consolidateLevels(pivots);
  }

  findVolumeLevels(bars) {
    // Group bars by price levels and find high volume areas
    const priceVolumeMap = new Map();

    bars.forEach(bar => {
      const priceLevel = Math.round(bar.close * 100) / 100; // Round to nearest cent
      const currentVolume = priceVolumeMap.get(priceLevel) || 0;
      priceVolumeMap.set(priceLevel, currentVolume + bar.volume);
    });

    // Sort by volume and take top levels
    const sortedLevels = Array.from(priceVolumeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 volume levels

    return sortedLevels.map(([price, volume]) => ({
      type: 'volume_level',
      value: price,
      strength: 'medium',
      source: 'volume_profile',
      volume: volume,
      confidence: 0.6
    }));
  }

  /**
   * Calculate regression trend lines using linear regression
   * Both automated regression and manual-style trend lines for confluence
   */
  calculateRegressionTrendLines(bars) {
    if (bars.length < 20) return [];

    const trendLines = [];

    // Calculate trend lines for different periods
    const periods = [20, 50]; // Short and medium term trend lines

    for (const period of periods) {
      if (bars.length < period) continue;

      const recentBars = bars.slice(-period);

      // Calculate trend line for highs (resistance trend)
      const highTrend = this.calculateLinearRegression(
        recentBars.map((bar, index) => ({ x: index, y: bar.high }))
      );

      // Calculate trend line for lows (support trend)
      const lowTrend = this.calculateLinearRegression(
        recentBars.map((bar, index) => ({ x: index, y: bar.low }))
      );

      // Current trend line values (extrapolated to current bar)
      const currentHighTrend = highTrend.slope * (period - 1) + highTrend.intercept;
      const currentLowTrend = lowTrend.slope * (period - 1) + lowTrend.intercept;

      // Only add trend lines with reasonable R-squared (good fit)
      if (highTrend.rSquared > 0.7) {
        trendLines.push({
          type: 'resistance_trend',
          value: currentHighTrend,
          strength: 'high',
          source: `regression_${period}_high`,
          slope: highTrend.slope,
          intercept: highTrend.intercept,
          rSquared: highTrend.rSquared,
          period: period,
          confidence: Math.min(0.9, highTrend.rSquared)
        });
      }

      if (lowTrend.rSquared > 0.7) {
        trendLines.push({
          type: 'support_trend',
          value: currentLowTrend,
          strength: 'high',
          source: `regression_${period}_low`,
          slope: lowTrend.slope,
          intercept: lowTrend.intercept,
          rSquared: lowTrend.rSquared,
          period: period,
          confidence: Math.min(0.9, lowTrend.rSquared)
        });
      }
    }

    return trendLines;
  }

  /**
   * Calculate linear regression for a set of points
   */
  calculateLinearRegression(points) {
    const n = points.length;
    const sumX = points.reduce((sum, point) => sum + point.x, 0);
    const sumY = points.reduce((sum, point) => sum + point.y, 0);
    const sumXY = points.reduce((sum, point) => sum + (point.x * point.y), 0);
    const sumXX = points.reduce((sum, point) => sum + (point.x * point.x), 0);
    const sumYY = points.reduce((sum, point) => sum + (point.y * point.y), 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssRes = points.reduce((sum, point) => {
      const predicted = slope * point.x + intercept;
      return sum + Math.pow(point.y - predicted, 2);
    }, 0);
    const ssTot = points.reduce((sum, point) => sum + Math.pow(point.y - yMean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);

    return { slope, intercept, rSquared };
  }

  /**
   * Enhanced support/resistance detection with multiple touch analysis
   */
  findSupportResistanceZones(bars) {
    if (bars.length < 30) return [];

    const zones = [];
    const pricePoints = [];

    // Collect significant high and low points
    bars.forEach((bar, index) => {
      if (index < 5 || index >= bars.length - 5) return;

      const window = bars.slice(index - 5, index + 6);
      const isLocalHigh = window.every(b => b.high <= bar.high);
      const isLocalLow = window.every(b => b.low >= bar.low);

      if (isLocalHigh) {
        pricePoints.push({
          price: bar.high,
          type: 'resistance', 
          timestamp: bar.timestamp,
          volume: bar.volume
        });
      }

      if (isLocalLow) {
        pricePoints.push({
          price: bar.low,
          type: 'support',
          timestamp: bar.timestamp,
          volume: bar.volume
        });
      }
    });

    // Group nearby price points to find zones with multiple touches
    const resistancePoints = pricePoints.filter(p => p.type === 'resistance');
    const supportPoints = pricePoints.filter(p => p.type === 'support');

    // Analyze resistance zones
    const resistanceZones = this.findPriceZones(resistancePoints, 'resistance');
    zones.push(...resistanceZones);

    // Analyze support zones
    const supportZones = this.findPriceZones(supportPoints, 'support');
    zones.push(...supportZones);

    return zones.filter(zone => zone.touches >= this.minTouchCount);
  }

  /**
   * Find price zones where price has bounced multiple times
   */
  findPriceZones(pricePoints, type) {
    const zones = [];
    const processed = new Set();

    pricePoints.forEach((point, index) => {
      if (processed.has(index)) return;

      const zone = [point];
      const zoneIndices = [index];

      // Find other points within tolerance
      pricePoints.forEach((otherPoint, otherIndex) => {
        if (otherIndex !== index && !processed.has(otherIndex)) {
          const priceDiff = Math.abs(point.price - otherPoint.price) / point.price;
          if (priceDiff <= this.tolerance * 2) { // Wider tolerance for zones
            zone.push(otherPoint);
            zoneIndices.push(otherIndex);
          }
        }
      });

      zoneIndices.forEach(idx => processed.add(idx));

      if (zone.length >= this.minTouchCount) {
        const avgPrice = zone.reduce((sum, p) => sum + p.price, 0) / zone.length;
        const totalVolume = zone.reduce((sum, p) => sum + p.volume, 0);
        const avgVolume = totalVolume / zone.length;

        // Calculate zone strength based on touches and volume
        let strength = 'medium';
        if (zone.length >= 5 && avgVolume > 1000000) strength = 'very_high';
        else if (zone.length >= 4 || avgVolume > 500000) strength = 'high';

        zones.push({
          type: type,
          value: avgPrice,
          strength: strength,
          source: `${type}_zone_${zone.length}_touches`,
          touches: zone.length,
          avgVolume: avgVolume,
          totalVolume: totalVolume,
          priceRange: {
            min: Math.min(...zone.map(p => p.price)),
            max: Math.max(...zone.map(p => p.price))
          },
          timestamps: zone.map(p => p.timestamp),
          confidence: Math.min(0.95, 0.5 + (zone.length * 0.1))
        });
      }
    });

    return zones;
  }

  consolidateLevels(levels) {
    const consolidated = [];
    const processed = new Set();

    levels.forEach((level, index) => {
      if (processed.has(index)) return;

      const similar = [level];
      const similarIndices = [index];

      levels.forEach((other, otherIndex) => {
        if (otherIndex !== index && !processed.has(otherIndex)) {
          const priceDiff = Math.abs(level.value - other.value) / level.value;
          if (priceDiff <= this.tolerance && level.type === other.type) {
            similar.push(other);
            similarIndices.push(otherIndex);
          }
        }
      });

      similarIndices.forEach(idx => processed.add(idx));

      const avgPrice = similar.reduce((sum, l) => sum + l.value, 0) / similar.length;
      const totalTouches = similar.reduce((sum, l) => sum + (l.touches || 1), 0);
      const avgConfidence = similar.reduce((sum, l) => sum + (l.confidence || 0.5), 0) / similar.length;

      consolidated.push({
        ...level,
        value: avgPrice,
        touches: totalTouches,
        strength: totalTouches >= 5 ? 'very_high' : 
                 totalTouches >= 3 ? 'high' : 'medium',
        confidence: Math.min(0.95, avgConfidence * (1 + (totalTouches - 1) * 0.1))
      });
    });

    return consolidated;
  }

  findConfluenceZones(levels) {
    const zones = [];
    const processed = new Set();

    levels.forEach((level, index) => {
      if (processed.has(index)) return;

      const confluenceGroup = [level];
      const confluenceIndices = [index];

      levels.forEach((other, otherIndex) => {
        if (otherIndex !== index && !processed.has(otherIndex)) {
          const priceDiff = Math.abs(level.value - other.value) / level.value;
          if (priceDiff <= this.tolerance * 3) { // Wider tolerance for confluence
            confluenceGroup.push(other);
            confluenceIndices.push(otherIndex);
          }
        }
      });

      confluenceIndices.forEach(idx => processed.add(idx));

      if (confluenceGroup.length >= 2) {
        const avgPrice = confluenceGroup.reduce((sum, l) => sum + l.value, 0) / confluenceGroup.length;
        const strengthScore = confluenceGroup.reduce((score, l) => {
          const weights = { low: 1, medium: 2, high: 3, very_high: 4 };
          return score + (weights[l.strength] || 1);
        }, 0);

        const avgConfidence = confluenceGroup.reduce((sum, l) => sum + (l.confidence || 0.5), 0) / confluenceGroup.length;

        zones.push({
          type: 'confluence_zone',
          value: avgPrice,
          strength: strengthScore >= 10 ? 'very_high' : 
                   strengthScore >= 6 ? 'high' : 'medium',
          confluence: confluenceGroup.length,
          sources: confluenceGroup.map(l => l.source),
          confidence: Math.min(0.95, avgConfidence * (1 + (confluenceGroup.length - 1) * 0.15)),
          range: {
            min: Math.min(...confluenceGroup.map(l => l.value)),
            max: Math.max(...confluenceGroup.map(l => l.value))
          },
          components: confluenceGroup
        });
      } else {
        zones.push(level);
      }
    });

    return zones.sort((a, b) => (b.confluence || 1) - (a.confluence || 1));
  }
}
