// lib/level-manager.js
// Manages support/resistance level persistence and touch tracking

export class LevelManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.touchThreshold = 0.002; // 0.2% price distance to consider a "touch"
    this.similarLevelThreshold = 0.005; // 0.5% threshold for similar levels
  }

  /**
   * Load active levels from database
   */
  async getActiveLevels(symbol, timeframe, minConfidence = 0.7) {
    try {
      const { data, error } = await this.supabase
        .from('detected_levels')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('is_active', true)
        .gte('confidence', minConfidence)
        .order('confidence', { ascending: false });

      if (error) {
        console.error('Error loading levels:', error);
        return [];
      }

      console.log(`Loaded ${data.length} active levels for ${symbol} ${timeframe}`);
      return data || [];
    } catch (err) {
      console.error('Exception in getActiveLevels:', err);
      return [];
    }
  }

  /**
   * Check if current price is touching a level and determine outcome
   */
  checkLevelTouch(level, currentBar) {
    if (!level || !currentBar) {
      return null;
    }

    // Determine price range for level (zone vs point)
    const priceRange = this.getLevelPriceRange(level);
    
    // Check if bar touches the level
    const isTouching = currentBar.low <= priceRange.max && currentBar.high >= priceRange.min;
    
    if (!isTouching) {
      return null;
    }

    // Determine touch outcome based on level type and close price
    const touchOutcome = this.determineTouchOutcome(level, currentBar, priceRange);
    
    return {
      touched: true,
      levelId: level.id,
      levelType: level.level_type,
      priceLevel: level.price_level,
      touchPrice: touchOutcome.touchPrice,
      touchType: touchOutcome.touchType,
      held: touchOutcome.held,
      distance: Math.abs(currentBar.close - level.price_level),
      distancePct: Math.abs((currentBar.close - level.price_level) / level.price_level),
      breakStrength: touchOutcome.breakStrength
    };
  }

  /**
   * Get price range for level (handles both zones and point levels)
   */
  getLevelPriceRange(level) {
    if (level.price_range_min && level.price_range_max) {
      // Level is a zone with defined range
      return {
        min: level.price_range_min,
        max: level.price_range_max
      };
    } else {
      // Point level - create range using touch threshold
      const threshold = level.price_level * this.touchThreshold;
      return {
        min: level.price_level - threshold,
        max: level.price_level + threshold
      };
    }
  }

  /**
   * Determine touch outcome (BOUNCE, BREAK, TEST)
   */
  determineTouchOutcome(level, currentBar, priceRange) {
    const closeAbove = currentBar.close > priceRange.max;
    const closeBelow = currentBar.close < priceRange.min;
    const closeInside = !closeAbove && !closeBelow;

    let touchType, held, touchPrice, breakStrength = 0;

    // Logic based on level type
    if (level.level_type.includes('support') || level.level_type === 'confluence_zone') {
      if (closeBelow) {
        touchType = 'BREAK';
        held = false;
        touchPrice = currentBar.low;
        breakStrength = Math.abs((priceRange.min - currentBar.close) / priceRange.min);
      } else {
        touchType = closeInside ? 'TEST' : 'BOUNCE';
        held = true;
        touchPrice = currentBar.low;
      }
    } else if (level.level_type.includes('resistance')) {
      if (closeAbove) {
        touchType = 'BREAK';
        held = false;
        touchPrice = currentBar.high;
        breakStrength = Math.abs((currentBar.close - priceRange.max) / priceRange.max);
      } else {
        touchType = closeInside ? 'TEST' : 'BOUNCE';
        held = true;
        touchPrice = currentBar.high;
      }
    } else {
      // MA levels or other types - use close price
      touchType = 'TEST';
      held = true;
      touchPrice = currentBar.close;
    }

    return { touchType, held, touchPrice, breakStrength };
  }

  /**
   * Record level touch in database
   */
  async recordTouch(touchData, currentBar) {
    try {
      const touch = {
        level_id: touchData.levelId,
        symbol: touchData.symbol,
        timeframe: touchData.timeframe,
        touch_time: currentBar.timestamp,
        touch_price: touchData.touchPrice,
        distance_from_level: touchData.distance,
        distance_pct: touchData.distancePct,
        touch_type: touchData.touchType,
        held: touchData.held,
        break_strength: touchData.breakStrength,
        bar_volume: currentBar.volume,
        bar_high: currentBar.high,
        bar_low: currentBar.low,
        bar_close: currentBar.close
      };

      const { error } = await this.supabase
        .from('level_touches')
        .insert(touch);

      if (error) {
        console.error('Error recording touch:', error);
        return { success: false, error };
      }

      // Update level statistics using atomic function
      const confidenceChange = touchData.held ? 0.02 : -0.05; // Increase confidence on hold, decrease on break
      
      const { error: updateError } = await this.supabase
        .rpc('update_level_stats', {
          p_level_id: touchData.levelId,
          p_touch_increment: 1,
          p_bounce_increment: touchData.held ? 1 : 0,
          p_break_increment: touchData.held ? 0 : 1,
          p_confidence_change: confidenceChange,
          p_last_touch_time: currentBar.timestamp,
          p_last_touch_price: touchData.touchPrice
        });

      if (updateError) {
        console.error('Error updating level stats:', updateError);
      }

      console.log(`Recorded ${touchData.touchType} touch for level ${touchData.levelType} at ${touchData.touchPrice}`);
      return { success: true };
    } catch (err) {
      console.error('Exception in recordTouch:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create or update level (upsert operation)
   */
  async upsertLevel(levelData) {
    try {
      // Check if similar level exists
      const existingLevel = await this.findSimilarLevel(
        levelData.symbol,
        levelData.timeframe,
        levelData.price_level,
        levelData.level_type
      );

      if (existingLevel) {
        // Update existing level
        return await this.updateExistingLevel(existingLevel, levelData);
      } else {
        // Create new level
        return await this.createNewLevel(levelData);
      }
    } catch (err) {
      console.error('Exception in upsertLevel:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Find similar level within threshold
   */
  async findSimilarLevel(symbol, timeframe, priceLevel, levelType) {
    try {
      const threshold = priceLevel * this.similarLevelThreshold;
      
      const { data, error } = await this.supabase
        .from('detected_levels')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('level_type', levelType)
        .eq('is_active', true)
        .gte('price_level', priceLevel - threshold)
        .lte('price_level', priceLevel + threshold)
        .limit(1);

      if (error) {
        console.error('Error finding similar level:', error);
        return null;
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (err) {
      console.error('Exception in findSimilarLevel:', err);
      return null;
    }
  }

  /**
   * Update existing level with new data
   */
  async updateExistingLevel(existingLevel, newLevelData) {
    try {
      // Merge sources arrays
      const existingSources = existingLevel.sources || [];
      const newSources = newLevelData.sources || [];
      const mergedSources = [...new Set([...existingSources, ...newSources])];

      // Update level data
      const updateData = {
        confidence: Math.min(1.0, existingLevel.confidence + 0.01), // Small confidence boost for reconfirmation
        confluence_count: mergedSources.length,
        sources: mergedSources,
        last_confirmed: new Date().toISOString(),
        
        // Update price if new data suggests different level
        price_level: this.calculateWeightedPrice(existingLevel, newLevelData),
        
        // Update metadata
        metadata: {
          ...existingLevel.metadata,
          ...newLevelData.metadata,
          reconfirmation_count: (existingLevel.metadata?.reconfirmation_count || 0) + 1
        }
      };

      const { data, error } = await this.supabase
        .from('detected_levels')
        .update(updateData)
        .eq('id', existingLevel.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating existing level:', error);
        return { success: false, error };
      }

      console.log(`Updated existing level ${existingLevel.level_id} with new confluence`);
      return { success: true, data, updated: true };
    } catch (err) {
      console.error('Exception in updateExistingLevel:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create new level in database
   */
  async createNewLevel(levelData) {
    try {
      const level = {
        level_id: `${levelData.symbol}_${levelData.timeframe}_${levelData.level_type}_${Date.now()}`,
        symbol: levelData.symbol,
        timeframe: levelData.timeframe,
        level_type: levelData.level_type,
        
        price_level: levelData.price_level,
        price_range_min: levelData.price_range_min,
        price_range_max: levelData.price_range_max,
        
        confidence: levelData.confidence || 0.5,
        strength: levelData.strength || 'medium',
        confluence_count: (levelData.sources || []).length,
        sources: levelData.sources || [],
        
        avg_volume_at_level: levelData.avg_volume_at_level,
        total_volume_at_level: levelData.total_volume_at_level || 0,
        
        metadata: levelData.metadata || {}
      };

      const { data, error } = await this.supabase
        .from('detected_levels')
        .insert(level)
        .select()
        .single();

      if (error) {
        console.error('Error creating new level:', error);
        return { success: false, error };
      }

      console.log(`Created new level: ${level.level_id} at ${level.price_level}`);
      return { success: true, data, created: true };
    } catch (err) {
      console.error('Exception in createNewLevel:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Calculate weighted price for level updates
   */
  calculateWeightedPrice(existingLevel, newLevelData) {
    const existingWeight = existingLevel.confluence_count || 1;
    const newWeight = (newLevelData.sources || []).length || 1;
    const totalWeight = existingWeight + newWeight;
    
    return (
      (existingLevel.price_level * existingWeight) + 
      (newLevelData.price_level * newWeight)
    ) / totalWeight;
  }

  /**
   * Get levels for confluence checking with patterns
   */
  async getLevelsForConfluence(symbol, timeframe, priceRange, minConfidence = 0.6) {
    try {
      const { data, error } = await this.supabase
        .rpc('get_active_levels_for_confluence', {
          p_symbol: symbol,
          p_timeframe: timeframe,
          p_min_confidence: minConfidence
        });

      if (error) {
        console.error('Error getting levels for confluence:', error);
        return [];
      }

      // Filter by price range
      const filteredLevels = data.filter(level => {
        const levelPrice = level.price_level;
        return levelPrice >= priceRange.min && levelPrice <= priceRange.max;
      });

      return filteredLevels;
    } catch (err) {
      console.error('Exception in getLevelsForConfluence:', err);
      return [];
    }
  }

  /**
   * Invalidate broken levels (mark as inactive)
   */
  async invalidateBrokenLevels(symbol, timeframe) {
    try {
      // Find levels with high break count relative to total touches
      const { data: brokenLevels, error } = await this.supabase
        .from('detected_levels')
        .select('id, level_id, break_count, touch_count')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('is_active', true)
        .gt('break_count', 0);

      if (error) {
        console.error('Error finding broken levels:', error);
        return { success: false, error };
      }

      const levelsToInvalidate = brokenLevels.filter(level => {
        const breakRatio = level.break_count / Math.max(level.touch_count, 1);
        return breakRatio > 0.5 || level.break_count >= 3; // Invalidate if >50% breaks or 3+ breaks
      });

      if (levelsToInvalidate.length === 0) {
        return { success: true, invalidatedCount: 0 };
      }

      const levelIds = levelsToInvalidate.map(l => l.id);
      
      const { error: updateError } = await this.supabase
        .from('detected_levels')
        .update({
          is_active: false,
          invalidated_at: new Date().toISOString()
        })
        .in('id', levelIds);

      if (updateError) {
        console.error('Error invalidating levels:', updateError);
        return { success: false, error: updateError };
      }

      console.log(`Invalidated ${levelsToInvalidate.length} broken levels`);
      return { success: true, invalidatedCount: levelsToInvalidate.length };
    } catch (err) {
      console.error('Exception in invalidateBrokenLevels:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get level statistics for analysis
   */
  async getLevelStats(symbol, timeframe, days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('detected_levels')
        .select(`
          level_type,
          confidence,
          touch_count,
          bounce_count,
          break_count,
          is_active
        `)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('first_detected', cutoffDate.toISOString());

      if (error) {
        console.error('Error getting level stats:', error);
        return null;
      }

      const stats = {
        total: data.length,
        active: data.filter(l => l.is_active).length,
        by_type: {},
        avg_confidence: 0,
        avg_touch_count: 0,
        hold_rate: 0
      };

      let confidenceSum = 0;
      let touchSum = 0;
      let totalHolds = 0;
      let totalTouches = 0;

      data.forEach(level => {
        // Count by type
        stats.by_type[level.level_type] = (stats.by_type[level.level_type] || 0) + 1;
        
        // Sum for averages
        confidenceSum += level.confidence || 0;
        touchSum += level.touch_count || 0;
        
        // Calculate hold rate
        totalHolds += level.bounce_count || 0;
        totalTouches += level.touch_count || 0;
      });

      if (data.length > 0) {
        stats.avg_confidence = confidenceSum / data.length;
        stats.avg_touch_count = touchSum / data.length;
      }

      if (totalTouches > 0) {
        stats.hold_rate = totalHolds / totalTouches;
      }

      return stats;
    } catch (err) {
      console.error('Exception in getLevelStats:', err);
      return null;
    }
  }

  /**
   * Clean up old inactive levels
   */
  async cleanupOldLevels(daysOld = 60) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { data, error } = await this.supabase
        .from('detected_levels')
        .delete()
        .eq('is_active', false)
        .lt('invalidated_at', cutoffDate.toISOString());

      if (error) {
        console.error('Error cleaning up old levels:', error);
        return { success: false, error };
      }

      console.log(`Cleaned up ${data?.length || 0} old inactive levels`);
      return { success: true, cleanedCount: data?.length || 0 };
    } catch (err) {
      console.error('Exception in cleanupOldLevels:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Convert detected levels from system_events format to level_manager format
   */
  convertSystemEventsLevels(systemEventLevels, symbol, timeframe) {
    if (!systemEventLevels || !Array.isArray(systemEventLevels)) {
      return [];
    }

    return systemEventLevels.map((level, index) => ({
      symbol,
      timeframe,
      level_type: level.type,
      price_level: level.value,
      price_range_min: level.range?.min,
      price_range_max: level.range?.max,
      confidence: level.confidence || 0.5,
      strength: level.strength || 'medium',
      sources: level.sources || [],
      confluence_count: level.confluence || 0,
      avg_volume_at_level: level.components?.[0]?.volume,
      total_volume_at_level: level.components?.reduce((sum, c) => sum + (c.volume || 0), 0) || 0,
      metadata: {
        detection_source: 'system_events',
        original_index: index,
        components: level.components
      }
    }));
  }
}