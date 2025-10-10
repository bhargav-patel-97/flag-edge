export class IndicatorCalculator {
    sma(data, period) {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / period);
        }
        return result;
    }

    ema(data, period) {
        const result = [];
        const multiplier = 2 / (period + 1);
        
        // First EMA is just SMA
        result[0] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = 1; i < data.length - period + 1; i++) {
            result[i] = (data[i + period - 1] - result[i - 1]) * multiplier + result[i - 1];
        }
        
        return result;
    }

    detectLevels(bars, indicators) {
        const levels = [];
        const { ma200, ma400 } = indicators;
        
        // Add MA levels
        if (ma200 && ma200.length > 0) {
            levels.push({
                type: 'ma200',
                value: ma200[ma200.length - 1],
                strength: 'high',
                source: '200MA'
            });
        }
        
        if (ma400 && ma400.length > 0) {
            levels.push({
                type: 'ma400',
                value: ma400[ma400.length - 1],
                strength: 'high',
                source: '400MA'
            });
        }

        // Detect swing highs and lows
        const swingLevels = this.findSwingLevels(bars);
        levels.push(...swingLevels);

        // Find confluence levels
        const confluenceLevels = this.findConfluenceLevels(levels);
        
        return confluenceLevels;
    }

    findSwingLevels(bars, lookback = 10) {
        const levels = [];
        
        for (let i = lookback; i < bars.length - lookback; i++) {
            const current = bars[i];
            const leftBars = bars.slice(i - lookback, i);
            const rightBars = bars.slice(i + 1, i + lookback + 1);
            
            // Check for swing high
            const isSwingHigh = leftBars.every(bar => bar.high <= current.high) &&
                               rightBars.every(bar => bar.high <= current.high);
            
            // Check for swing low
            const isSwingLow = leftBars.every(bar => bar.low >= current.low) &&
                              rightBars.every(bar => bar.low >= current.low);
            
            if (isSwingHigh) {
                levels.push({
                    type: 'resistance',
                    value: current.high,
                    strength: 'medium',
                    source: 'swing_high',
                    timestamp: current.timestamp
                });
            }
            
            if (isSwingLow) {
                levels.push({
                    type: 'support',
                    value: current.low,
                    strength: 'medium',
                    source: 'swing_low',
                    timestamp: current.timestamp
                });
            }
        }
        
        return levels;
    }

    findConfluenceLevels(levels, tolerance = 0.001) {
        const confluenceLevels = [];
        const processedLevels = new Set();
        
        levels.forEach((level, index) => {
            if (processedLevels.has(index)) return;
            
            const similarLevels = [level];
            const similarIndices = [index];
            
            levels.forEach((otherLevel, otherIndex) => {
                if (otherIndex !== index && !processedLevels.has(otherIndex)) {
                    const priceDiff = Math.abs(level.value - otherLevel.value) / level.value;
                    if (priceDiff <= tolerance) {
                        similarLevels.push(otherLevel);
                        similarIndices.push(otherIndex);
                    }
                }
            });
            
            similarIndices.forEach(idx => processedLevels.add(idx));
            
            const avgPrice = similarLevels.reduce((sum, l) => sum + l.value, 0) / similarLevels.length;
            const strength = similarLevels.length >= 3 ? 'very_high' : 
                           similarLevels.length === 2 ? 'high' : 'medium';
            
            confluenceLevels.push({
                type: level.type,
                value: avgPrice,
                strength,
                confluence: similarLevels.length,
                sources: similarLevels.map(l => l.source)
            });
        });
        
        return confluenceLevels.sort((a, b) => b.confluence - a.confluence);
    }

    rsi(data, period = 14) {
        const changes = [];
        for (let i = 1; i < data.length; i++) {
            changes.push(data[i] - data[i - 1]);
        }
        
        const gains = changes.map(change => change > 0 ? change : 0);
        const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);
        
        const avgGains = this.sma(gains, period);
        const avgLosses = this.sma(losses, period);
        
        return avgGains.map((avgGain, i) => {
            const rs = avgGain / avgLosses[i];
            return 100 - (100 / (1 + rs));
        });
    }
}
