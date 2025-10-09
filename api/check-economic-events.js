// api/check-economic-events.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    // Fetch economic events from external API
    const response = await fetch(
      `https://api.tradingeconomics.com/calendar?c=${process.env.TRADING_ECONOMICS_KEY}&f=json`
    );
    const events = await response.json();

    // Filter high-impact events
    const highImpactEvents = events.filter(event => 
      event.Importance === 'High' &&
      new Date(event.Date) > new Date() &&
      new Date(event.Date) < new Date(Date.now() + 24 * 3600000)
    );

    // Store events in database
    for (const event of highImpactEvents) {
      await supabase.from('economic_events').upsert({
        event_name: event.Event,
        event_date: event.Date,
        impact_level: event.Importance,
        trading_pause: shouldPauseTrading(event.Event)
      });
    }

    res.json({
      status: 'updated',
      high_impact_events: highImpactEvents.length
    });

  } catch (error) {
    console.error('Economic events error:', error);
    res.status(500).json({ error: error.message });
  }
}
