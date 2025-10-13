
export class FlagDetector {
  constructor() {
    this.minFlagBars = 5; // Minimum bars for flag formation
    this.maxFlagBars = 20; // Maximum bars for flag formation
    this.minMovePercent = 0.02; // Minimum 2% move before flag
    this.flagSlopeThreshold = 0.001; // Maximum slope for consolidation
    this.volumeDecreaseThreshold = 0.8; // Volume should decrease during flag
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

    // Analyze potential flag pattern with enhanced criteria
    const flagBars = bars.slice(-this.maxFlagBars);
    const flagPattern = this.analyzeFlagPattern(flagBars, moveAnalysis.direction);

    if (!flagPattern.isFlag) {
      return null;
    }

    // Enhanced confluence check with key levels
    const confluence = this.calculateConfluence(flagPattern, levels);

    // Enhanced volume confirmation
    const volumeConfirmation = this.analyzeVolumePattern(flagBars, moveAnalysis);

    // Determine breakout level and direction
    const breakoutLevel = this.calculateBreakoutLevel(flagPattern, moveAnalysis.direction);

    // Enhanced pattern validation
    const validity = this.validateFlagPattern(flagPattern, moveAnalysis, volumeConfirmation);

    return {
      pattern: 'flag',
      direction: moveAnalysis.direction,
      preMoveStrength: moveAnalysis.strength,
      flagBars: flagPattern.bars,
      consolidationRange: flagPattern.range,
      confluence: confluence,
      breakoutLevel: breakoutLevel,
      timeframe: flagPattern.timeframe,
      volume: {
        ...flagPattern.volumeProfile,
        confirmation: volumeConfirmation
      },
      validity: validity,
      preMoveData: {
        movePercent: moveAnalysis.movePercent,
        volumeRatio: moveAnalysis.volumeRatio,
        duration: moveAnalysis.duration
      }
    };
  }

  analyzeRecentMove(bars) {
    // Look at last 50 bars for significant move (increased from 30)
    const lookbackBars = Math.min(50, bars.length - this.maxFlagBars);
    const moveBars = bars.slice(-(lookbackBars + this.maxFlagBars), -this.maxFlagBars);

    if (moveBars.length < 5) {
      return { significantMove: false };
    }

    const startPrice = moveBars[0].close;
    const endPrice = moveBars[moveBars.length - 1].close;
    const movePercent = (endPrice - startPrice) / startPrice;

    const direction = movePercent > 0 ? 'bullish' : 'bearish';
    const absMovePercent = Math.abs(movePercent);

    // Enhanced move analysis with multiple criteria
    const avgVolume = moveBars.reduce((sum, bar) => sum + bar.volume, 0) / moveBars.length;
    const baselineVolume = this.calculateBaselineVolume(bars, moveBars.length);
    const volumeRatio = avgVolume / baselineVolume;

    // Calculate move velocity (price change per bar)
    const velocity = absMovePercent / moveBars.length;

    // Enhanced strength calculation
    let strength = 'weak';
    if (absMovePercent >= 0.08 && volumeRatio > 1.5 && velocity > 0.002) {
      strength = 'very_strong';
    } else if (absMovePercent >= 0.05 && volumeRatio > 1.3) {
      strength = 'strong';
    } else if (absMovePercent >= 0.03 && volumeRatio > 1.1) {
      strength = 'medium';
    }

    return {
      significantMove: absMovePercent >= this.minMovePercent,
      direction,
      movePercent: absMovePercent,
      strength,
      volumeConfirmation: volumeRatio > 1.2,
      volumeRatio,
      velocity,
      duration: moveBars.length,
      startPrice,
      endPrice
    };
  }

  calculateBaselineVolume(bars, excludeLastN) {
    // Calculate baseline volume excluding the recent move
    const baselineBars = bars.slice(0, bars.length - excludeLastN - this.maxFlagBars);
    if (baselineBars.length < 20) {
      // Fallback to overall average if not enough data
      return bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length;
    }

    return baselineBars.slice(-30).reduce((sum, bar) => sum + bar.volume, 0) / Math.min(30, baselineBars.length);
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

    // Enhanced consolidation check
    const priceRange = flagRange / flagMidpoint;
    const isConsolidating = priceRange < 0.04; // Increased tolerance slightly

    // Enhanced trend analysis within flag
    const flagSlope = this.calculateSlope(closes);
    const expectedSlope = expectedDirection === 'bullish' ? 'down' : 'up';

    // More nuanced slope validation
    const slopeIsCorrect = this.validateFlagSlope(flagSlope, expectedDirection);

    // Enhanced volume analysis
    const volumePattern = this.analyzeVolumeDecline(volumes);

    // Price action quality check
    const priceActionQuality = this.analyzePriceAction(flagBars);

    // Time analysis
    const timeframe = flagBars.length <= 8 ? 'short' : 
                     flagBars.length <= 15 ? 'medium' : 'long';

    return {
      isFlag: isConsolidating && slopeIsCorrect && volumePattern.isDecreasing,
      bars: flagBars.length,
      range: { 
        high: flagHigh, 
        low: flagLow, 
        percent: priceRange,
        midpoint: flagMidpoint
      },
      slope: flagSlope,
      slopeDirection: flagSlope > 0.0005 ? 'up' : flagSlope < -0.0005 ? 'down' : 'flat',
      volumeProfile: {
        decreasing: volumePattern.isDecreasing,
        avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
        volumeDeclineRate: volumePattern.declineRate,
        volumeQuality: volumePattern.quality
      },
      priceActionQuality,
      timeframe,
      consolidationScore: this.calculateConsolidationScore(flagBars)
    };
  }

  validateFlagSlope(slope, expectedDirection) {
    // More nuanced slope validation
    if (expectedDirection === 'bullish') {
      // Bullish flag should have slight downward or flat slope
      return slope <= this.flagSlopeThreshold;
    } else {
      // Bearish flag should have slight upward or flat slope  
      return slope >= -this.flagSlopeThreshold;
    }
  }

  analyzeVolumeDecline(volumes) {
    if (volumes.length < 3) return { isDecreasing: true, declineRate: 0, quality: 'poor' };

    const firstThird = volumes.slice(0, Math.floor(volumes.length / 3));
    const lastThird = volumes.slice(-Math.floor(volumes.length / 3));

    const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
    const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;

    const declineRate = (firstAvg - lastAvg) / firstAvg;
    const isDecreasing = lastAvg < firstAvg * this.volumeDecreaseThreshold;

    // Quality assessment
    let quality = 'poor';
    if (declineRate > 0.4) quality = 'excellent';
    else if (declineRate > 0.2) quality = 'good';
    else if (declineRate > 0.1) quality = 'fair';

    return {
      isDecreasing,
      declineRate,
      quality,
      firstThirdAvg: firstAvg,
      lastThirdAvg: lastAvg
    };
  }

  analyzePriceAction(flagBars) {
    // Analyze the quality of price action during consolidation
    const closes = flagBars.map(bar => bar.close);
    const highs = flagBars.map(bar => bar.high);
    const lows = flagBars.map(bar => bar.low);

    // Check for clean consolidation (no major spikes)
    const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
    const maxDeviation = Math.max(
      ...closes.map(close => Math.abs(close - avgClose) / avgClose)
    );

    // Analyze wick quality (not too many long wicks)
    const wickQuality = this.analyzeWickQuality(flagBars);

    return {
      maxDeviation,
      wickQuality,
      consistency: maxDeviation < 0.02 ? 'excellent' : 
                  maxDeviation < 0.03 ? 'good' : 'fair',
      avgClose
    };
  }

  analyzeWickQuality(bars) {
    let longWickCount = 0;
    const totalBars = bars.length;

    bars.forEach(bar => {
      const bodySize = Math.abs(bar.close - bar.open);
      const upperWick = bar.high - Math.max(bar.open, bar.close);
      const lowerWick = Math.min(bar.open, bar.close) - bar.low;

      const maxWick = Math.max(upperWick, lowerWick);

      // Long wick if wick is more than 2x the body size
      if (maxWick > bodySize * 2) {
        longWickCount++;
      }
    });

    const longWickRatio = longWickCount / totalBars;

    return {
      longWickCount,
      longWickRatio,
      quality: longWickRatio < 0.2 ? 'excellent' : 
              longWickRatio < 0.4 ? 'good' : 'poor'
    };
  }

  calculateConsolidationScore(flagBars) {
    // Calculate a score for how well the price consolidated
    const closes = flagBars.map(bar => bar.close);
    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const range = high - low;
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;

    // Tighter consolidation gets higher score
    const rangePercent = range / avgPrice;

    let score = 0;
    if (rangePercent < 0.01) score = 10; // Excellent
    else if (rangePercent < 0.02) score = 8; // Good
    else if (rangePercent < 0.03) score = 6; // Fair
    else if (rangePercent < 0.04) score = 4; // Poor
    else score = 2; // Very poor

    return {
      score,
      rangePercent,
      rating: score >= 8 ? 'excellent' : 
             score >= 6 ? 'good' : 
             score >= 4 ? 'fair' : 'poor'
    };
  }

  analyzeVolumePattern(flagBars, moveAnalysis) {
    const volumes = flagBars.map(bar => bar.volume);
    const avgFlagVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Compare flag volume to pre-move volume
    const volumeRatioToMove = avgFlagVolume / (moveAnalysis.volumeRatio * this.calculateBaselineVolume([], 0));

    return {
      avgFlagVolume,
      volumeRatioToMove,
      decreasing: this.analyzeVolumeDecline(volumes).isDecreasing,
      quality: volumeRatioToMove < 0.7 ? 'excellent' : 
              volumeRatioToMove < 0.9 ? 'good' : 'fair'
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

  calculateConfluence(flagPattern, levels) {
    let confluenceScore = 0;
    const flagHigh = flagPattern.range.high;
    const flagLow = flagPattern.range.low;
    const flagMid = flagPattern.range.midpoint;
    const tolerance = 0.008; // Slightly wider tolerance for confluence

    levels.forEach(level => {
      const levelValue = level.value;

      // Check if level is near flag boundaries or middle
      const nearFlagHigh = Math.abs(levelValue - flagHigh) / flagHigh < tolerance;
      const nearFlagLow = Math.abs(levelValue - flagLow) / flagLow < tolerance;
      const nearFlagMid = Math.abs(levelValue - flagMid) / flagMid < tolerance;

      if (nearFlagHigh || nearFlagLow || nearFlagMid) {
        const strengthWeights = { 
          low: 1, 
          medium: 2, 
          high: 3, 
          very_high: 4 
        };

        let score = strengthWeights[level.strength] || 1;

        // Bonus for high confidence levels
        if (level.confidence && level.confidence > 0.8) {
          score *= 1.5;
        }

        // Bonus for levels with multiple touches
        if (level.touches && level.touches > 2) {
          score *= (1 + (level.touches - 2) * 0.2);
        }

        confluenceScore += score;
      }
    });

    return confluenceScore;
  }

  calculateBreakoutLevel(flagPattern, direction) {
    const buffer = flagPattern.range.percent * 0.1; // 10% of flag range as buffer

    if (direction === 'bullish') {
      return flagPattern.range.high * (1 + buffer);
    } else {
      return flagPattern.range.low * (1 - buffer);
    }
  }

  validateFlagPattern(flagPattern, moveAnalysis, volumeConfirmation) {
    let validityScore = 0;

    // Pre-move strength scoring (enhanced)
    if (moveAnalysis.strength === 'very_strong') validityScore += 4;
    else if (moveAnalysis.strength === 'strong') validityScore += 3;
    else if (moveAnalysis.strength === 'medium') validityScore += 2;
    else validityScore += 1;

    // Volume confirmation scoring (enhanced)
    if (moveAnalysis.volumeConfirmation) validityScore += 3;
    if (volumeConfirmation.quality === 'excellent') validityScore += 2;
    else if (volumeConfirmation.quality === 'good') validityScore += 1;

    // Consolidation quality scoring
    if (flagPattern.consolidationScore.score >= 8) validityScore += 3;
    else if (flagPattern.consolidationScore.score >= 6) validityScore += 2;
    else if (flagPattern.consolidationScore.score >= 4) validityScore += 1;

    // Volume pattern during flag
    if (flagPattern.volumeProfile.volumeQuality === 'excellent') validityScore += 2;
    else if (flagPattern.volumeProfile.volumeQuality === 'good') validityScore += 1;

    // Price action quality
    if (flagPattern.priceActionQuality.consistency === 'excellent') validityScore += 2;
    else if (flagPattern.priceActionQuality.consistency === 'good') validityScore += 1;

    // Timeframe bonus (short flags are often more reliable)
    if (flagPattern.timeframe === 'short') validityScore += 1;

    // Move velocity bonus
    if (moveAnalysis.velocity > 0.003) validityScore += 1;

    return {
      score: validityScore,
      maxScore: 17, // Updated max score
      rating: validityScore >= 13 ? 'excellent' : 
             validityScore >= 10 ? 'very_good' :
             validityScore >= 7 ? 'good' :
             validityScore >= 5 ? 'fair' : 'poor',
      confidence: Math.min(0.95, validityScore / 17)
    };
  }
}
