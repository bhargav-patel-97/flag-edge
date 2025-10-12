# flag-edge

**Level Flag Automated Trading System**

flag-edge is a low-latency, feature-flag-driven automated trading system built with JavaScript and deployed on Vercel Edge Functions. It detects classic flag patterns in market data and executes option trades based on breakout signals and confluence with key support/resistance levels.

## Table of Contents
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Risk Management](#risk-management)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Features
- **Time-Based Bar Aggregation**: 1-minute bars aggregated to 2-minute (9:30–10:00), 5-minute (10:00–11:00), and 10-minute (11:00–16:30) intervals.
- **Level Detection**: Calculates 200-period and 400-period moving averages, pivot points, volume profile levels, and confluence zones.
- **Flag Pattern Recognition**: Identifies bullish/bearish flag patterns with volume and slope analysis.
- **Option Selection & Execution**: Chooses optimal options by delta, liquidity, spread, and DTE, submitting bracket orders with stop loss and take profit.
- **Risk Management**: Enforces max daily loss, max open positions, buying power checks, and consecutive loss limits.
- **Database Logging**: Logs all bars, levels, executions, trades, and system events to Supabase.
- **Webhook-Driven**: Supports FastCron webhooks to trigger timeframe-specific strategy execution.

## Architecture
![Level Flag Trading System Architecture](chart:12)

## Prerequisites
- Node.js v16+ and npm or Yarn
- Vercel CLI
- Alpaca broker API account (paper trading recommended)
- Supabase project with tables:
  - `minute_bars`
  - `aggregated_bars`
  - `strategy_executions`
  - `trades`
  - `system_events`
  - `error_logs`

## Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/bhargav-patel-97/flag-edge.git
   cd flag-edge
   ```
2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```
3. Login to Vercel:
   ```bash
   vercel login
   ```

## Configuration
Copy `.env.example` to `.env` and set values:
```env
# Alpaca API
ALPACA_API_KEY=your_key
ALPACA_SECRET_KEY=your_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets
PAPER_TRADING=true

# Supabase
SUPABASE_URL=https://your.supabase.url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Strategy Parameters
MAX_DAILY_LOSS=0.02            # 2% of account equity
MAX_POSITION_SIZE=0.05        # 5% of account equity
RISK_PER_TRADE=0.01           # 1% of account equity
TRADING_ENABLED=true

# Economic Calendar
TRADING_ECONOMICS_KEY=your_economic_api_key

# FastCron Webhooks
FASTCRON_SECRET=your_webhook_secret
```

## Usage
### Local Development
```bash
npm run dev      # or vercel dev
```

### Fetch Bars Cron Job
- Deployed at `api/cron/fetch-bars.js`
- Runs every minute to fetch 1-minute bars and aggregate them.

### Webhook-Triggered Strategy
- Endpoint: `api/webhook/trade-signal.js`
- Accepts POST with JSON: `{ timeframe: '2Min'|'5Min'|'10Min', force: boolean }`

### Health Check
```bash
GET /api/health-check
```

## Project Structure
```
api/
  cron/
    fetch-bars.js       # Fetch & aggregate bars
  webhook/
    trade-signal.js     # Strategy execution trigger
  execute-strategy.js   # Direct strategy runner
  market-data.js        # Indicators & levels endpoint
  portfolio-status.js   # Account & positions endpoint
  trade-history.js      # Past trades & stats
lib/
  alpaca-client.js      # Alpaca API & DB bar fetch
  data-fetcher.js       # Raw bar ingestion to Supabase
  bar-aggregator.js     # Aggregates minute bars by timeframe
  level-detector.js     # MA, pivots, volume, confluence
  flag-detector.js      # Flag pattern analysis
  level-flag-strategy.js# Core strategy logic
  option-selector.js    # Optimal option contract selection
  risk-manager.js       # Risk checks & position sizing
  economic-calendar.js  # High-impact event checks
  indicators.js         # SMA, EMA, RSI
  security.js           # Webhook signature verification
  supabase-client.js    # Strategy/trade/event logging
```

## Risk Management
- Halts trading on reaching `MAX_DAILY_LOSS`
- Limits open positions to configured maximum
- Maintains minimum buying power (10% of equity)
- Pauses after consecutive losses (≥3)

## Deployment
1. Push to `main` branch.
2. Vercel will auto-deploy using Edge Functions.
3. Monitor logs:
   ```bash
   vercel logs flag-edge --prod
   ```

## Contributing
Contributions are welcome! Please:
1. Fork the repo
2. Create a branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License
MIT License