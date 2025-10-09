// lib/level-detector.js
export class LevelDetector {
  constructor(ma200, ma400) {
    this.ma200 = ma200;
    this.ma400 = ma400;
    this.minTouches = 2;
    this.proximityThreshold = 0.1; // 0.1% price proximity
  }

  detectLevels(bars) {
    const levels = [];
    
    // Add MA-based levels
    const currentMA200 = this.ma200[this.ma200.length - 1];
    const currentMA400 = this.ma400[this.ma400.length - 1];
    
    if (currentMA200) {
      levels.push({
        type: 'ma200',
        value: currentMA200,
        strength: 'high',
        source: 'moving_average'
      });
    }
    
    if (currentMA400) {
      levels.push({
        type: 'ma400',
        value: currentMA400,
        strength: 'high',
        source: 'moving_average'
      });
    }

    // Detect pivot-based support/resistance
    const pivots = this.findPivotPoints(bars);
    const clusters = this.clusterPivots(pivots);
    
    levels.push(...clusters);
    
    return levels;
  }

  findPivotPoints(bars, lookback = 5) {
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
          price: current.high,
          timestamp: current.timestamp,
          volume: current.volume
        });
      }
      
      // Pivot low
      if (leftBars.every(bar => bar.low >= current.low) &&
          rightBars.every(bar => bar.low >= current.low)) {
        pivots.push({
          type: 'support',
          price: current.low,
          timestamp: current.timestamp,
          volume: current.volume
        });
      }
    }
    
    return pivots;
  }

  clusterPivots(pivots) {
    const clusters = [];
    const processed = new Set();
    
    for (let i = 0; i < pivots.length; i++) {
      if (processed.has(i)) continue;
      
      const pivot = pivots[i];
      const cluster = [pivot];
      processed.add(i);
      
      // Find nearby pivots
      for (let j = i + 1; j < pivots.length; j++) {
        if (processed.has(j)) continue;
        
        const other = pivots[j];
        const priceDiff = Math.abs(pivot.price - other.price);
        const pricePercent = (priceDiff / pivot.price) * 100;
        
        if (pricePercent <= this.proximityThreshold && 
            pivot.type === other.type) {
          cluster.push(other);
          processed.add(j);
        }
      }
      
      if (cluster.length >= this.minTouches) {
        const avgPrice = cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
        const totalVolume = cluster.reduce((sum, p) => sum + p.volume, 0);
        
        clusters.push({
          type: pivot.type,
          value: avgPrice,
          strength: this.calculateStrength(cluster.length, totalVolume),
          touches: cluster.length,
          source: 'pivot_cluster'
        });
      }
    }
    
    return clusters;
  }

  calculateStrength(touches, volume) {
    const touchScore = Math.min(touches / 5, 1); // Max at 5 touches
    const volumeScore = Math.min(volume / 1000000, 1); // Normalize volume
    const combinedScore = (touchScore + volumeScore) / 2;
    
    if (combinedScore > 0.7) return 'high';
    if (combinedScore > 0.4) return 'medium';
    return 'low';
  }
}
