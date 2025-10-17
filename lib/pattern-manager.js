// lib/pattern-manager.js
// Manages pattern lifecycle and persistence across Vercel Edge Function invocations

export class PatternManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.touchThreshold = 0.005; // 0.5% price distance for breakout confirmation
  }

  /**
   * Load active patterns from database that need monitoring
   */
  async getActivePatterns(symbol, timeframe) {
    try {
      const { data, error } = await this.supabase
        .from('pattern_states')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .in('stage', ['FORMING', 'CONSOLIDATING', 'CONFIRMED'])
        .gt('expires_at', new Date().toISOString())
        .order('detected_at', { ascending: false });

      if (error) {
        console.error('Error loading active patterns:', error);
        return [];
      }

      console.log(`Loaded ${data.length} active patterns for ${symbol} ${timeframe}`);
      return data || [];
    } catch (err) {
      console.error('Exception in getActivePatterns:', err);
      return [];
    }
  }

  /**
   * Check if pattern has broken out based on current price and volume
   */
  checkBreakout(pattern, currentPrice, currentVolume, currentBar) {
    const isBullish = pattern.pattern_type === 'bullish_flag';
    const breakoutLevel = pattern.breakout_level;
    
    if (!breakoutLevel || !currentPrice) {
      return { breakout: false, reason: 'Missing price or breakout level' };
    }

    // Calculate breakout threshold (allow small buffer for noise)
    const thresholdBuffer = breakoutLevel * this.touchThreshold;
    
    let breakoutConfirmed = false;
    let direction = null;
    let breakoutStrength = 0;

    if (isBullish) {
      // Bullish flag: price must break above breakout level
      if (currentPrice > breakoutLevel + thresholdBuffer) {
        breakoutConfirmed = true;
        direction = 'up';
        breakoutStrength = ((currentPrice - breakoutLevel) / breakoutLevel) * 100;
      }
    } else {
      // Bearish flag: price must break below breakout level
      if (currentPrice < breakoutLevel - thresholdBuffer) {
        breakoutConfirmed = true;
        direction = 'down';
        breakoutStrength = ((breakoutLevel - currentPrice) / breakoutLevel) * 100;
      }
    }

    if (!breakoutConfirmed) {
      return { 
        breakout: false, 
        reason: `Price ${currentPrice} not beyond breakout level ${breakoutLevel}`,
        currentPrice,
        breakoutLevel,
        direction: isBullish ? 'up' : 'down'
      };
    }

    // Check volume confirmation
    const volumeThreshold = pattern.pole_avg_volume * 0.6; // 60% of pole volume
    const volumeConfirmed = currentVolume >= volumeThreshold;

    // Check bar-level confirmation (close must also confirm breakout)
    const barConfirmed = isBullish ? 
      currentBar.close > breakoutLevel :
      currentBar.close < breakoutLevel;

    return {
      breakout: true,
      direction,
      volumeConfirmed,
      barConfirmed,
      breakoutStrength,
      currentPrice,
      breakoutLevel,
      currentVolume,
      volumeThreshold,
      poleAvgVolume: pattern.pole_avg_volume
    };
  }

  /**
   * Update pattern stage when breakout occurs
   */
  async markBreakout(patternId, breakoutData, currentBar) {
    try {
      const updateData = {
        stage: 'BROKEN_OUT',
        breakout_time: currentBar.timestamp || new Date().toISOString(),
        breakout_volume: breakoutData.currentVolume,
        volume_confirmation: breakoutData.volumeConfirmed,
        last_updated: new Date().toISOString()
      };

      const { error } = await this.supabase
        .from('pattern_states')
        .update(updateData)
        .eq('pattern_id', patternId);

      if (error) {
        console.error('Error updating pattern breakout:', error);
        return { success: false, error };
      }

      console.log(`Pattern ${patternId} marked as BROKEN_OUT at ${breakoutData.currentPrice}`);
      
      // Log to system_events for audit trail
      await this.logPatternEvent(patternId, 'BREAKOUT_CONFIRMED', {
        breakout_price: breakoutData.currentPrice,
        breakout_strength: breakoutData.breakoutStrength,
        volume_confirmed: breakoutData.volumeConfirmed,
        bar_confirmed: breakoutData.barConfirmed
      });

      return { success: true, data: updateData };
    } catch (err) {
      console.error('Exception in markBreakout:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create new pattern in database
   */
  async createPattern(patternData) {
    try {
      const pattern = {
        pattern_id: `${patternData.symbol}_${patternData.timeframe}_${Date.now()}`,
        symbol: patternData.symbol,
        timeframe: patternData.timeframe,
        pattern_type: patternData.pattern_type,
        stage: 'FORMING',
        confidence: patternData.confidence || 0.5,
        quality_score: patternData.quality_score || 0.0,
        
        // Pattern geometry
        pole_start_time: patternData.pole?.start,
        pole_end_time: patternData.pole?.end,
        pole_start_price: patternData.pole?.startPrice,
        pole_end_price: patternData.pole?.endPrice,
        pole_length_pct: patternData.pole?.lengthPct,
        
        flag_start_time: patternData.flag?.start,
        flag_high: patternData.flag?.high,
        flag_low: patternData.flag?.low,
        flag_slope: patternData.flag?.slope,
        
        breakout_level: patternData.breakout_level,
        
        // Volume data
        pole_avg_volume: patternData.pole?.avgVolume,
        flag_avg_volume: patternData.flag?.avgVolume,
        
        // Confluence
        near_resistance: patternData.near_resistance,
        near_support: patternData.near_support,
        confluence_count: patternData.confluence_count || 0,
        
        expires_at: this.calculateExpiration(patternData.timeframe)
      };

      const { data, error } = await this.supabase
        .from('pattern_states')
        .insert(pattern)
        .select()
        .single();

      if (error) {
        console.error('Error creating pattern:', error);
        return { success: false, error };
      }

      console.log(`Created new pattern: ${pattern.pattern_id} (${pattern.pattern_type})`);
      
      // Log pattern creation
      await this.logPatternEvent(pattern.pattern_id, 'PATTERN_DETECTED', {
        quality_score: pattern.quality_score,
        confluence_count: pattern.confluence_count,
        pole_length_pct: pattern.pole_length_pct
      });

      return { success: true, data };
    } catch (err) {
      console.error('Exception in createPattern:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update pattern stage (e.g., FORMING -> CONSOLIDATING -> CONFIRMED)
   */
  async updatePatternStage(patternId, newStage, additionalData = {}) {
    try {
      const updateData = {
        stage: newStage,
        last_updated: new Date().toISOString(),
        ...additionalData
      };

      const { error } = await this.supabase
        .from('pattern_states')
        .update(updateData)
        .eq('pattern_id', patternId);

      if (error) {
        console.error('Error updating pattern stage:', error);
        return { success: false, error };
      }

      console.log(`Pattern ${patternId} stage updated to ${newStage}`);
      return { success: true };
    } catch (err) {
      console.error('Exception in updatePatternStage:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Calculate pattern expiration time based on timeframe
   */
  calculateExpiration(timeframe) {
    const now = new Date();
    
    // Expiration time in bars - patterns should expire if they don't break out
    const expirationBars = {
      '2m': 30,   // 60 minutes
      '5m': 24,   // 120 minutes  
      '10m': 18,  // 180 minutes
      '2Min': 30, // Handle both formats
      '5Min': 24,
      '10Min': 18
    };
    
    const timeframeKey = timeframe.toLowerCase().replace('min', 'm');
    const bars = expirationBars[timeframeKey] || expirationBars[timeframe] || 20;
    const minutes = parseInt(timeframe.replace(/[^0-9]/g, '')) * bars;
    
    now.setMinutes(now.getMinutes() + minutes);
    return now.toISOString();
  }

  /**
   * Expire old patterns that have timed out
   */
  async expireOldPatterns() {
    try {
      const { data, error } = await this.supabase
        .rpc('expire_old_patterns');

      if (error) {
        console.error('Error expiring patterns:', error);
        return { success: false, error };
      }

      if (data > 0) {
        console.log(`Expired ${data} old patterns`);
      }

      return { success: true, expiredCount: data };
    } catch (err) {
      console.error('Exception in expireOldPatterns:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Mark pattern as failed (broke in wrong direction)
   */
  async markPatternFailed(patternId, reason, currentPrice) {
    try {
      const updateData = {
        stage: 'FAILED',
        last_updated: new Date().toISOString()
      };

      const { error } = await this.supabase
        .from('pattern_states')
        .update(updateData)
        .eq('pattern_id', patternId);

      if (error) {
        console.error('Error marking pattern as failed:', error);
        return { success: false, error };
      }

      console.log(`Pattern ${patternId} marked as FAILED: ${reason}`);
      
      await this.logPatternEvent(patternId, 'PATTERN_FAILED', {
        reason,
        price_at_failure: currentPrice
      });

      return { success: true };
    } catch (err) {
      console.error('Exception in markPatternFailed:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get pattern statistics for analysis
   */
  async getPatternStats(symbol, timeframe, days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('pattern_states')
        .select('stage, pattern_type, quality_score, confidence')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('detected_at', cutoffDate.toISOString());

      if (error) {
        console.error('Error getting pattern stats:', error);
        return null;
      }

      const stats = {
        total: data.length,
        by_stage: {},
        by_type: {},
        avg_quality: 0,
        avg_confidence: 0,
        success_rate: 0
      };

      let qualitySum = 0;
      let confidenceSum = 0;
      let successCount = 0;

      data.forEach(pattern => {
        // Count by stage
        stats.by_stage[pattern.stage] = (stats.by_stage[pattern.stage] || 0) + 1;
        
        // Count by type
        stats.by_type[pattern.pattern_type] = (stats.by_type[pattern.pattern_type] || 0) + 1;
        
        // Sum for averages
        qualitySum += pattern.quality_score || 0;
        confidenceSum += pattern.confidence || 0;
        
        // Count successful breakouts
        if (pattern.stage === 'BROKEN_OUT') {
          successCount++;
        }
      });

      if (data.length > 0) {
        stats.avg_quality = qualitySum / data.length;
        stats.avg_confidence = confidenceSum / data.length;
        stats.success_rate = successCount / data.length;
      }

      return stats;
    } catch (err) {
      console.error('Exception in getPatternStats:', err);
      return null;
    }
  }

  /**
   * Log pattern events for audit trail
   */
  async logPatternEvent(patternId, eventType, eventData) {
    try {
      const logData = {
        event_type: 'PATTERN_EVENT',
        symbol: eventData.symbol || 'QQQ',
        timeframe: eventData.timeframe || '10Min',
        timestamp: new Date().toISOString(),
        event_details: {
          pattern_id: patternId,
          event_type: eventType,
          ...eventData
        }
      };

      await this.supabase
        .from('system_events')
        .insert(logData);

    } catch (err) {
      console.error('Exception in logPatternEvent:', err);
      // Don't fail the main operation if logging fails
    }
  }

  /**
   * Clean up old completed patterns (older than specified days)
   */
  async cleanupOldPatterns(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { data, error } = await this.supabase
        .from('pattern_states')
        .delete()
        .in('stage', ['BROKEN_OUT', 'FAILED', 'EXPIRED'])
        .lt('last_updated', cutoffDate.toISOString());

      if (error) {
        console.error('Error cleaning up old patterns:', error);
        return { success: false, error };
      }

      console.log(`Cleaned up ${data?.length || 0} old patterns`);
      return { success: true, cleanedCount: data?.length || 0 };
    } catch (err) {
      console.error('Exception in cleanupOldPatterns:', err);
      return { success: false, error: err.message };
    }
  }
}