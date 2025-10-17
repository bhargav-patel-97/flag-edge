// lib/execution-state-manager.js
// Manages execution state across Vercel Edge Function invocations

export class ExecutionStateManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Get or create execution state for symbol/timeframe
   */
  async getExecutionState(symbol, timeframe) {
    try {
      let { data, error } = await this.supabase
        .from('execution_state')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .single();

      if (error && error.code === 'PGRST116') {
        // Record doesn't exist, create it
        const newState = {
          symbol,
          timeframe,
          last_bar_processed: null,
          active_patterns_count: 0,
          active_levels_count: 0,
          bars_analyzed: 0,
          patterns_detected_today: 0,
          signals_generated_today: 0,
          trades_executed_today: 0,
          last_daily_reset: new Date().toISOString().split('T')[0] // Current date
        };

        const { data: insertedData, error: insertError } = await this.supabase
          .from('execution_state')
          .insert(newState)
          .select()
          .single();

        if (insertError) {
          console.error('Error creating execution state:', insertError);
          return newState; // Return default state if insert fails
        }

        console.log(`Created new execution state for ${symbol} ${timeframe}`);
        return insertedData;
      }

      if (error) {
        console.error('Error fetching execution state:', error);
        return this.getDefaultExecutionState(symbol, timeframe);
      }

      // Check if daily reset is needed
      const today = new Date().toISOString().split('T')[0];
      if (data.last_daily_reset !== today) {
        return await this.performDailyReset(data, today);
      }

      return data;
    } catch (err) {
      console.error('Exception in getExecutionState:', err);
      return this.getDefaultExecutionState(symbol, timeframe);
    }
  }

  /**
   * Update execution state after processing
   */
  async updateExecutionState(symbol, timeframe, updates) {
    try {
      const updateData = {
        ...updates,
        last_execution_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('execution_state')
        .update(updateData)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .select()
        .single();

      if (error) {
        console.error('Error updating execution state:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (err) {
      console.error('Exception in updateExecutionState:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Increment daily counters
   */
  async incrementCounters(symbol, timeframe, counters) {
    try {
      // Build the update object with increments
      const updateData = {};
      
      if (counters.patterns_detected) {
        updateData.patterns_detected_today = { increment: counters.patterns_detected };
      }
      if (counters.signals_generated) {
        updateData.signals_generated_today = { increment: counters.signals_generated };
      }
      if (counters.trades_executed) {
        updateData.trades_executed_today = { increment: counters.trades_executed };
      }
      if (counters.bars_analyzed) {
        updateData.bars_analyzed = { increment: counters.bars_analyzed };
      }

      // Since Supabase doesn't support increment operations directly in JavaScript,
      // we'll use an RPC function or handle it with a transaction
      const currentState = await this.getExecutionState(symbol, timeframe);
      
      const updatedData = {
        patterns_detected_today: currentState.patterns_detected_today + (counters.patterns_detected || 0),
        signals_generated_today: currentState.signals_generated_today + (counters.signals_generated || 0),
        trades_executed_today: currentState.trades_executed_today + (counters.trades_executed || 0),
        bars_analyzed: currentState.bars_analyzed + (counters.bars_analyzed || 0),
        last_execution_time: new Date().toISOString()
      };

      return await this.updateExecutionState(symbol, timeframe, updatedData);
    } catch (err) {
      console.error('Exception in incrementCounters:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if processing is needed based on last processed bar
   */
  shouldProcessBars(executionState, latestBarTimestamp) {
    if (!executionState.last_bar_processed) {
      return true; // First run, process all available bars
    }

    const lastProcessed = new Date(executionState.last_bar_processed);
    const latestBar = new Date(latestBarTimestamp);
    
    return latestBar > lastProcessed;
  }

  /**
   * Get bars since last processing
   */
  getTimestampFilter(executionState) {
    if (!executionState.last_bar_processed) {
      return null; // No filter, get recent bars based on default limit
    }

    return executionState.last_bar_processed;
  }

  /**
   * Perform daily reset of counters
   */
  async performDailyReset(executionState, today) {
    try {
      console.log(`Performing daily reset for ${executionState.symbol} ${executionState.timeframe}`);
      
      const resetData = {
        patterns_detected_today: 0,
        signals_generated_today: 0,
        trades_executed_today: 0,
        last_daily_reset: today,
        last_execution_time: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('execution_state')
        .update(resetData)
        .eq('symbol', executionState.symbol)
        .eq('timeframe', executionState.timeframe)
        .select()
        .single();

      if (error) {
        console.error('Error performing daily reset:', error);
        return { ...executionState, ...resetData };
      }

      return data;
    } catch (err) {
      console.error('Exception in performDailyReset:', err);
      return { ...executionState, patterns_detected_today: 0, signals_generated_today: 0, trades_executed_today: 0 };
    }
  }

  /**
   * Update cache timestamps
   */
  async updateCacheTimestamps(symbol, timeframe, cacheTypes) {
    try {
      const updateData = {};
      const now = new Date().toISOString();

      if (cacheTypes.includes('levels')) {
        updateData.levels_cache_updated = now;
      }
      if (cacheTypes.includes('patterns')) {
        updateData.patterns_cache_updated = now;
      }

      return await this.updateExecutionState(symbol, timeframe, updateData);
    } catch (err) {
      console.error('Exception in updateCacheTimestamps:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if cache is fresh
   */
  isCacheFresh(executionState, cacheType, maxAgeMinutes = 30) {
    const cacheField = `${cacheType}_cache_updated`;
    const cacheTimestamp = executionState[cacheField];
    
    if (!cacheTimestamp) {
      return false;
    }

    const cacheTime = new Date(cacheTimestamp);
    const now = new Date();
    const ageMinutes = (now - cacheTime) / (1000 * 60);

    return ageMinutes < maxAgeMinutes;
  }

  /**
   * Get execution statistics
   */
  async getExecutionStats(symbol, timeframe = null) {
    try {
      let query = this.supabase
        .from('execution_state')
        .select('*')
        .eq('symbol', symbol);

      if (timeframe) {
        query = query.eq('timeframe', timeframe);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting execution stats:', error);
        return null;
      }

      if (timeframe) {
        return data[0] || null;
      }

      // Aggregate stats across timeframes
      const stats = {
        total_patterns_today: data.reduce((sum, state) => sum + state.patterns_detected_today, 0),
        total_signals_today: data.reduce((sum, state) => sum + state.signals_generated_today, 0),
        total_trades_today: data.reduce((sum, state) => sum + state.trades_executed_today, 0),
        total_bars_analyzed: data.reduce((sum, state) => sum + state.bars_analyzed, 0),
        timeframes: data.length,
        last_execution: data.reduce((latest, state) => {
          const stateTime = new Date(state.last_execution_time || 0);
          return stateTime > latest ? stateTime : latest;
        }, new Date(0))
      };

      return stats;
    } catch (err) {
      console.error('Exception in getExecutionStats:', err);
      return null;
    }
  }

  /**
   * Default execution state for fallback
   */
  getDefaultExecutionState(symbol, timeframe) {
    return {
      symbol,
      timeframe,
      last_bar_processed: null,
      last_execution_time: new Date().toISOString(),
      active_patterns_count: 0,
      active_levels_count: 0,
      bars_analyzed: 0,
      patterns_detected_today: 0,
      signals_generated_today: 0,
      trades_executed_today: 0,
      levels_cache_updated: null,
      patterns_cache_updated: null,
      last_daily_reset: new Date().toISOString().split('T')[0]
    };
  }

  /**
   * Health check for execution state
   */
  async healthCheck(symbol, timeframe) {
    try {
      const state = await this.getExecutionState(symbol, timeframe);
      const now = new Date();
      const lastExecution = new Date(state.last_execution_time || 0);
      const timeSinceLastExecution = (now - lastExecution) / (1000 * 60); // minutes

      return {
        healthy: timeSinceLastExecution < 60, // Consider healthy if executed within last hour
        last_execution: state.last_execution_time,
        minutes_since_last_execution: Math.round(timeSinceLastExecution),
        daily_activity: {
          patterns_detected: state.patterns_detected_today,
          signals_generated: state.signals_generated_today,
          trades_executed: state.trades_executed_today
        },
        cache_status: {
          levels_fresh: this.isCacheFresh(state, 'levels'),
          patterns_fresh: this.isCacheFresh(state, 'patterns')
        }
      };
    } catch (err) {
      console.error('Exception in healthCheck:', err);
      return {
        healthy: false,
        error: err.message
      };
    }
  }

  /**
   * Reset execution state (for debugging/maintenance)
   */
  async resetExecutionState(symbol, timeframe) {
    try {
      const resetData = this.getDefaultExecutionState(symbol, timeframe);
      
      const { data, error } = await this.supabase
        .from('execution_state')
        .upsert(resetData)
        .select()
        .single();

      if (error) {
        console.error('Error resetting execution state:', error);
        return { success: false, error };
      }

      console.log(`Reset execution state for ${symbol} ${timeframe}`);
      return { success: true, data };
    } catch (err) {
      console.error('Exception in resetExecutionState:', err);
      return { success: false, error: err.message };
    }
  }
}