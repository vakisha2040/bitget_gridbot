# Bitget grid personal trading asistant bot

A Node.js-based grid trading bot for Binnance with Telegram control panel, automatic state management, and logging.

## Features

- **Grid Trading Strategy**: Fully automated grid trading for Bybit linear contracts.
- **Hedging Support**: Opens hedge trades when stop-loss is triggered.
- **Real-Time Price Feed**:
- **Telegram Bot Control**: Start/stop, view and update config, and manual trading from Telegram.
- **Persistent Logging**: All actions logged to file and optionally to Telegram.
- **Configurable**: All parameters via `config/config.json` or Telegram.

## Requirements

- Node.js v16+ (recommended)
- Binance account with API key/secret (with trading permissions)
