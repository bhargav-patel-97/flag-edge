export class LevelDetector {
    constructor() {
        this.tolerance = 0.002; // 0.2% tolerance for level matching
    }

    detectLevels(bars, indicators) {
        const levels = [];
        const { ma200, ma400 } = indicators;
        
        // Add moving average levels
        if (ma200 && ma200.length > 0) {
            levels.push({
                type: 'ma200',
                value: ma200[ma200.length - 1],
                strength: 'high',
                source: '200_period_ma'
            });
        }
        
        if (ma400 && ma400.length > 0) {
            levels.push({
                type: 'ma400',
                value: ma400[ma400.length - 1],
                strength: 'high',
                source: '400_period_ma'
            });
        }

        // Detect pivot points
        const pivots = this.findPivotPoints(bars);
        levels.push(...pivots);

        // Detect volume profile levels
        const volumeLevels = this.findVolumeLevels(bars);
        levels.push(...volumeLevels);

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
                    touches: 1
                });
            }
            
            if (isPivotLow) {
                pivots.push({
                    type: 'support',
                    value: current.low,
                    strength: 'medium',
                    source: 'pivot_low',
                    timestamp: current.timestamp,
                    touches: 1
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
            volume: volume
        }));
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
            
            consolidated.push({
                ...level,
                value: avgPrice,
                touches: totalTouches,
                strength: totalTouches >= 3 ? 'very_high' : 
                         totalTouches === 2 ? 'high' : 'medium'
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
                    if (priceDiff <= this.tolerance * 2) { // Wider tolerance for confluence
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
                
                zones.push({
                    type: 'confluence_zone',
                    value: avgPrice,
                    strength: strengthScore >= 8 ? 'very_high' : 
                             strengthScore >= 5 ? 'high' : 'medium',
                    confluence: confluenceGroup.length,
                    sources: confluenceGroup.map(l => l.source),
                    range: {
                        min: Math.min(...confluenceGroup.map(l => l.value)),
                        max: Math.max(...confluenceGroup.map(l => l.value))
                    }
                });
            } else {
                zones.push(level);
            }
        });
        
        return zones.sort((a, b) => (b.confluence || 1) - (a.confluence || 1));
    }
}
