export class FlagDetector {
    constructor() {
        this.minFlagBars = 5;     // Minimum bars for flag formation
        this.maxFlagBars = 20;    // Maximum bars for flag formation
        this.minMovePercent = 0.02; // Minimum 2% move before flag
        this.flagSlopeThreshold = 0.001; // Maximum slope for consolidation
    }

    detectFlag(bars, levels) {
        if (bars.length < this.minFlagBars + 10) {
            return null;
        }

        // Look for significant move before potential flag
        const moveAnalysis = this.analyzeRecentMove(bars);
        if (!moveAnalysis.significantMove) {
            return null;
        }

        // Analyze potential flag pattern
        const flagBars = bars.slice(-this.maxFlagBars);
        const flagPattern = this.analyzeFlagPattern(flagBars, moveAnalysis.direction);
        
        if (!flagPattern.isFlag) {
            return null;
        }

        // Check confluence with key levels
        const confluence = this.calculateConfluence(flagPattern, levels);

        // Determine breakout level and direction
        const breakoutLevel = this.calculateBreakoutLevel(flagPattern, moveAnalysis.direction);

        return {
            pattern: 'flag',
            direction: moveAnalysis.direction,
            preMoveStrength: moveAnalysis.strength,
            flagBars: flagPattern.bars,
            consolidationRange: flagPattern.range,
            confluence: confluence,
            breakoutLevel: breakoutLevel,
            timeframe: flagPattern.timeframe,
            volume: flagPattern.volumeProfile,
            validity: this.validateFlagPattern(flagPattern, moveAnalysis)
        };
    }

    analyzeRecentMove(bars) {
        // Look at last 30 bars for significant move
        const lookbackBars = Math.min(30, bars.length - this.maxFlagBars);
        const moveBars = bars.slice(-(lookbackBars + this.maxFlagBars), -this.maxFlagBars);
        
        if (moveBars.length < 5) {
            return { significantMove: false };
        }

        const startPrice = moveBars[0].close;
        const endPrice = moveBars[moveBars.length - 1].close;
        const movePercent = (endPrice - startPrice) / startPrice;
        
        const direction = movePercent > 0 ? 'bullish' : 'bearish';
        const absMovePercent = Math.abs(movePercent);
        
        // Calculate move strength based on percentage and volume
        const avgVolume = moveBars.reduce((sum, bar) => sum + bar.volume, 0) / moveBars.length;
        const recentAvgVolume = bars.slice(-50, -30).reduce((sum, bar) => sum + bar.volume, 0) / 20;
        const volumeRatio = avgVolume / recentAvgVolume;
        
        const strength = absMovePercent >= 0.05 ? 'strong' :
                        absMovePercent >= 0.03 ? 'medium' : 'weak';
        
        return {
            significantMove: absMovePercent >= this.minMovePercent,
            direction,
            movePercent: absMovePercent,
            strength,
            volumeConfirmation: volumeRatio > 1.2,
            startPrice,
            endPrice
        };
    }

    analyzeFlagPattern(flagBars, expectedDirection) {
        if (flagBars.length < this.minFlagBars) {
            return { isFlag: false };
        }

        const highs = flagBars.map(bar => bar.high);
        const lows = flagBars.map(bar => bar.low);
        const closes = flagBars.map(bar => bar.close);
        const volumes = flagBars.map(bar => bar.volume);
        
        // Calculate flag boundaries
        const flagHigh = Math.max(...highs);
        const flagLow = Math.min(...lows);
        const flagRange = flagHigh - flagLow;
        const flagMidpoint = (flagHigh + flagLow) / 2;
        
        // Check if price is consolidating (low volatility)
        const priceRange = flagRange / flagMidpoint;
        const isConsolidating = priceRange < 0.03; // Less than 3% range
        
        // Check trend within flag (should be slight counter-trend)
        const flagSlope = this.calculateSlope(closes);
        const expectedSlope = expectedDirection === 'bullish' ? 'down' : 'up';
        const hasCorrectSlope = (expectedSlope === 'down' && flagSlope < this.flagSlopeThreshold) ||
                               (expectedSlope === 'up' && flagSlope > -this.flagSlopeThreshold);
        
        // Volume analysis (should be decreasing during flag)
        const volumeDecreasing = this.isVolumeDecreasing(volumes);
        
        // Time analysis
        const timeframe = flagBars.length <= 10 ? 'short' : 'medium';
        
        return {
            isFlag: isConsolidating && hasCorrectSlope,
            bars: flagBars.length,
            range: { high: flagHigh, low: flagLow, percent: priceRange },
            slope: flagSlope,
            volumeProfile: {
                decreasing: volumeDecreasing,
                avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length
            },
            timeframe
        };
    }

    calculateSlope(prices) {
        const n = prices.length;
        const xSum = (n * (n - 1)) / 2;
        const ySum = prices.reduce((a, b) => a + b, 0);
        const xySum = prices.reduce((sum, price, index) => sum + (price * index), 0);
        const xSquaredSum = (n * (n - 1) * (2 * n - 1)) / 6;
        
        return (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum);
    }

    isVolumeDecreasing(volumes) {
        if (volumes.length < 3) return true;
        
        const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2));
        const secondHalf = volumes.slice(Math.floor(volumes.length / 2));
        
        const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        return secondHalfAvg < firstHalfAvg;
    }

    calculateConfluence(flagPattern, levels) {
        let confluenceScore = 0;
        const flagHigh = flagPattern.range.high;
        const flagLow = flagPattern.range.low;
        const tolerance = 0.005; // 0.5% tolerance
        
        levels.forEach(level => {
            const levelValue = level.value;
            
            // Check if level is near flag boundaries
            const nearFlagHigh = Math.abs(levelValue - flagHigh) / flagHigh < tolerance;
            const nearFlagLow = Math.abs(levelValue - flagLow) / flagLow < tolerance;
            
            if (nearFlagHigh || nearFlagLow) {
                const strengthWeights = { low: 1, medium: 2, high: 3, very_high: 4 };
                confluenceScore += strengthWeights[level.strength] || 1;
            }
        });
        
        return confluenceScore;
    }

    calculateBreakoutLevel(flagPattern, direction) {
        if (direction === 'bullish') {
            return flagPattern.range.high + (flagPattern.range.high * 0.001); // 0.1% above high
        } else {
            return flagPattern.range.low - (flagPattern.range.low * 0.001); // 0.1% below low
        }
    }

    validateFlagPattern(flagPattern, moveAnalysis) {
        let validityScore = 0;
        
        // Strong pre-move increases validity
        if (moveAnalysis.strength === 'strong') validityScore += 3;
        else if (moveAnalysis.strength === 'medium') validityScore += 2;
        else validityScore += 1;
        
        // Volume confirmation increases validity
        if (moveAnalysis.volumeConfirmation) validityScore += 2;
        
        // Proper consolidation increases validity
        if (flagPattern.range.percent < 0.02) validityScore += 2; // Very tight range
        else if (flagPattern.range.percent < 0.03) validityScore += 1;
        
        // Decreasing volume during flag increases validity
        if (flagPattern.volumeProfile.decreasing) validityScore += 1;
        
        // Optimal timeframe increases validity
        if (flagPattern.timeframe === 'short') validityScore += 1;
        
        return {
            score: validityScore,
            rating: validityScore >= 7 ? 'excellent' :
                   validityScore >= 5 ? 'good' :
                   validityScore >= 3 ? 'fair' : 'poor'
        };
    }
}
