# flag-edge

**Level Flag Automated Trading System**

flag-edge is a low-latency, feature-flag-driven automated trading system built with JavaScript and deployed on Vercel’s Edge Functions. It detects classic flag patterns in market data and executes trades automatically via broker APIs. Feature flags allow real-time toggling of strategies and parameters without redeployment.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Risk Management](#risk-management)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Flag Pattern Detection:** Identifies flagpoles and consolidation flags in price data.
- **Automated Execution:** Places trades automatically upon breakout confirmation.
- **Real-Time Feature Flags:** Toggle strategies, risk limits, and parameters via Vercel Edge Config.
- **Edge-Optimized:** Deployed on Vercel Edge Functions for minimal latency.

---

## Prerequisites

- Node.js (v16 or higher)
- NPM or Yarn
- Vercel CLI
- Broker API account (e.g., Alpaca, Interactive Brokers) with API keys

---

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

---

## Configuration

Create a `.env` file in the project root with the following variables:

```bash
# Broker API credentials
BROKER_API_KEY=your_api_key
BROKER_API_SECRET=your_api_secret

# Trading parameters
FLAG_LOOKBACK_PERIOD=50          # Number of bars to analyze for patterns
BREAKOUT_CONFIRMATION_VOLUME=1.5 # Multiplier of average volume for breakout
POSITION_SIZE=100                # Units per trade
MAX_DAILY_LOSS=500               # USD

# Vercel Edge Config
VERCEL_EDGE_CONFIG_TOKEN=your_vercel_token
VERCEL_PROJECT_ID=your_project_id
```

---

## Usage

### Local Development

```bash
npm run dev
# or
vercel dev
```

### Running in Production

1. Push changes to `main` branch.
2. Vercel will auto-deploy using Edge Functions.
3. Monitor logs via Vercel dashboard:
   ```bash
   vercel logs flag-edge --prod
   ```

---

## Risk Management

- **Max Daily Loss:** Automatic halt on reaching `MAX_DAILY_LOSS`.
- **Position Sizing:** Configurable `POSITION_SIZE` for capital control.
- **Kill Switch:** Emergency disable via Edge Config feature flag.

---

## Testing

Add test scripts under `./tests` and run:

```bash
npm test
# or
yarn test
```

We recommend adding unit and integration tests for pattern detection, order execution, and error handling.

---

## Deployment

Deploy to Vercel:

```bash
vercel --prod
``` 

Feature flags can be managed on Vercel Edge Config dashboard under “Project Settings > Edge Config.”

---

## Contributing

Contributions are welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please follow the existing code style and add tests for new functionality.

---

## License

This project is licensed under the MIT License.
