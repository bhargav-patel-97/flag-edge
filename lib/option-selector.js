export class OptionSelector {
    constructor() {
        this.targetDelta = { min: 0.20, max: 0.50 };
        this.maxSpreadPercent = 0.05;
        this.minVolume = 50;
        this.minOpenInterest = 100;
        this.maxDTE = 45; // Days to expiration
        this.minDTE = 7;
    }

    selectOption(optionChain, direction, riskAmount) {
        if (!optionChain || !optionChain.contracts) {
            return null;
        }

        // Filter options based on direction
        const optionType = direction === 'bullish' ? 'call' : 'put';
        const relevantOptions = optionChain.contracts.filter(contract => 
            contract.type.toLowerCase() === optionType
        );

        // Apply basic filters
        const filteredOptions = relevantOptions.filter(option => 
            this.passesBasicFilters(option)
        );

        if (filteredOptions.length === 0) {
            return null;
        }

        // Score and rank options
        const scoredOptions = filteredOptions.map(option => ({
            ...option,
            score: this.scoreOption(option, direction, riskAmount)
        }));

        // Sort by score and select best option
        scoredOptions.sort((a, b) => b.score - a.score);
        const bestOption = scoredOptions[0];

        if (bestOption.score < 50) { // Minimum acceptable score
            return null;
        }

        // Calculate position size
        const quantity = this.calculateQuantity(bestOption, riskAmount);

        return {
            symbol: bestOption.symbol,
            type: bestOption.type,
            strike: bestOption.strike,
            expiration: bestOption.expiration,
            price: bestOption.mark_price || bestOption.last_price,
            delta: bestOption.greeks?.delta,
            gamma: bestOption.greeks?.gamma,
            theta: bestOption.greeks?.theta,
            implied_volatility: bestOption.implied_volatility,
            quantity: quantity,
            score: bestOption.score
        };
    }

    passesBasicFilters(option) {
        // Check days to expiration
        const dte = this.getDaysToExpiration(option.expiration);
        if (dte < this.minDTE || dte > this.maxDTE) {
            return false;
        }

        // Check delta range
        const delta = Math.abs(option.greeks?.delta || 0);
        if (delta < this.targetDelta.min || delta > this.targetDelta.max) {
            return false;
        }

        // Check liquidity
        if ((option.volume || 0) < this.minVolume || 
            (option.open_interest || 0) < this.minOpenInterest) {
            return false;
        }

        // Check bid-ask spread
        if (option.bid && option.ask) {
            const spread = (option.ask - option.bid) / option.ask;
            if (spread > this.maxSpreadPercent) {
                return false;
            }
        }

        // Check if option has price
        const price = option.mark_price || option.last_price;
        if (!price || price <= 0.05) { // Minimum $0.05
            return false;
        }

        return true;
    }

    scoreOption(option, direction, riskAmount) {
        let score = 0;

        // Delta score (closer to 0.35 is ideal)
        const delta = Math.abs(option.greeks?.delta || 0);
        const deltaScore = 100 - (Math.abs(delta - 0.35) * 200);
        score += deltaScore * 0.3;

        // Gamma score (higher is better for short-term trades)
        const gamma = option.greeks?.gamma || 0;
        const gammaScore = Math.min(gamma * 1000, 100); // Normalize gamma
        score += gammaScore * 0.2;

        // Theta score (less negative is better)
        const theta = option.greeks?.theta || 0;
        const thetaScore = 100 - (Math.abs(theta) * 100);
        score += Math.max(thetaScore, 0) * 0.15;

        // Volume score
        const volume = option.volume || 0;
        const volumeScore = Math.min((volume / 200) * 100, 100);
        score += volumeScore * 0.15;

        // Open interest score
        const openInterest = option.open_interest || 0;
        const oiScore = Math.min((openInterest / 500) * 100, 100);
        score += oiScore * 0.1;

        // Spread score
        if (option.bid && option.ask) {
            const spread = (option.ask - option.bid) / option.ask;
            const spreadScore = Math.max(100 - (spread * 2000), 0);
            score += spreadScore * 0.1;
        }

        return Math.max(score, 0);
    }

    calculateQuantity(option, riskAmount) {
        const optionPrice = option.mark_price || option.last_price;
        const maxContracts = Math.floor(riskAmount / (optionPrice * 100)); // Each contract = 100 shares
        
        // Limit position size for risk management
        return Math.min(maxContracts, 10); // Max 10 contracts per trade
    }

    getDaysToExpiration(expirationDate) {
        const expiration = new Date(expirationDate);
        const now = new Date();
        const timeDiff = expiration.getTime() - now.getTime();
        return Math.ceil(timeDiff / (1000 * 3600 * 24));
    }

    analyzeImpliedVolatility(option, historicalIV) {
        const currentIV = option.implied_volatility;
        
        if (!historicalIV || historicalIV.length === 0) {
            return { percentile: 50, recommendation: 'neutral' };
        }

        // Calculate IV percentile
        const sortedIV = [...historicalIV].sort((a, b) => a - b);
        const position = sortedIV.findIndex(iv => iv >= currentIV);
        const percentile = (position / sortedIV.length) * 100;

        let recommendation;
        if (percentile < 25) {
            recommendation = 'low_iv'; // Good for buying options
        } else if (percentile > 75) {
            recommendation = 'high_iv'; // Consider selling strategies
        } else {
            recommendation = 'neutral';
        }

        return {
            percentile,
            recommendation,
            currentIV,
            avgIV: sortedIV.reduce((a, b) => a + b, 0) / sortedIV.length
        };
    }
}
