// lib/option-selector.js
export class OptionSelector {
  constructor() {
    this.targetDeltaRange = [0.20, 0.50];
    this.maxIVPercentile = 70;
    this.minVolume = 100;
    this.maxBidAskSpread = 0.05;
  }

  async selectOptimalOption(underlyingSymbol, direction, budget) {
    try {
      // Fetch option chain from Alpaca
      const optionChain = await alpacaClient.getOptionChain(underlyingSymbol, {
        expiration_date_gte: this.getMinExpiration(),
        expiration_date_lte: this.getMaxExpiration()
      });

      if (!optionChain || optionChain.length === 0) {
        throw new Error('No options available');
      }

      // Filter options based on direction
      const filteredOptions = optionChain.filter(option => 
        direction === 'bullish' ? option.type === 'call' : option.type === 'put'
      );

      // Apply selection criteria
      const qualifiedOptions = filteredOptions
        .filter(this.applyLiquidityFilters.bind(this))
        .filter(this.applyDeltaFilters.bind(this))
        .filter(opt => this.calculateCost(opt) <= budget);

      if (qualifiedOptions.length === 0) {
        return null;
      }

      // Score and rank options
      const scoredOptions = qualifiedOptions
        .map(option => ({
          ...option,
          score: this.calculateOptionScore(option)
        }))
        .sort((a, b) => b.score - a.score);

      return scoredOptions[0];

    } catch (error) {
      console.error('Option selection error:', error);
      return null;
    }
  }

  applyLiquidityFilters(option) {
    const bidAskSpread = (option.ask - option.bid) / option.ask;
    return option.volume >= this.minVolume &&
           option.open_interest >= 500 &&
           bidAskSpread <= this.maxBidAskSpread;
  }

  applyDeltaFilters(option) {
    const delta = Math.abs(option.greeks?.delta || 0);
    return delta >= this.targetDeltaRange[0] && delta <= this.targetDeltaRange[1];
  }

  calculateOptionScore(option) {
    const delta = Math.abs(option.greeks?.delta || 0);
    const gamma = option.greeks?.gamma || 0;
    const theta = Math.abs(option.greeks?.theta || 0);
    const iv = option.implied_volatility || 0;
    
    // Scoring components
    const deltaScore = this.scoreDelta(delta);
    const gammaScore = Math.min(gamma * 100, 1); // Normalize gamma
    const thetaScore = 1 - Math.min(theta / 0.05, 1); // Lower theta is better
    const liquidityScore = this.scoreLiquidity(option.volume, option.open_interest);
    const ivScore = this.scoreIV(iv);
    
    // Weighted combination
    return (deltaScore * 0.3) + 
           (gammaScore * 0.2) + 
           (thetaScore * 0.2) + 
           (liquidityScore * 0.2) + 
           (ivScore * 0.1);
  }

  scoreDelta(delta) {
    const optimal = 0.35; // Sweet spot for delta
    const distance = Math.abs(delta - optimal);
    return Math.max(0, 1 - (distance / optimal));
  }

  scoreLiquidity(volume, openInterest) {
    const volumeScore = Math.min(volume / 500, 1);
    const oiScore = Math.min(openInterest / 1000, 1);
    return (volumeScore + oiScore) / 2;
  }

  scoreIV(iv) {
    // Prefer moderate IV levels
    if (iv < 0.2) return iv / 0.2; // Too low
    if (iv > 0.6) return Math.max(0, (1 - iv) / 0.4); // Too high
    return 1; // Sweet spot 20-60%
  }

  calculateCost(option) {
    return (option.bid + option.ask) / 2;
  }

  getMinExpiration() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  getMaxExpiration() {
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 45); // Max 45 days
    return maxDate.toISOString().split('T')[0];
  }
}