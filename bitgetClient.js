require('dotenv').config();
const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('./config.json');

class BitgetClient {
  constructor(cfg = config, logger = console) {
    this.config = cfg;
    this.logger = logger;
    this.sendMessage = () => {};
    this.apiKey = process.env.BITGET_API_KEY;
    this.apiSecret = process.env.BITGET_API_SECRET;
    this.passphrase = process.env.BITGET_API_PASSPHRASE;
    this.baseURL = 'https://api.bitget.com';
    this.category = cfg.category || 'USDT-FUTURES'; // default futures category
  }

  sign(timestamp, method, path, body = '') {
    const payload = `${timestamp}${method}${path}${body}`;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(payload)
      .digest('base64');
  }

  async request(method, path, params = {}, body = null) {
    const timestamp = Date.now().toString();
    const query =
      method === 'GET' && Object.keys(params).length
        ? `?${new URLSearchParams(params)}`
        : '';
    const fullPath = `${path}${query}`;
    const url = `${this.baseURL}${fullPath}`;
    const bodyStr = body ? JSON.stringify(body) : '';
    const signature = this.sign(timestamp, method, fullPath, bodyStr);

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'locale': 'en-US',
      },
      body: method !== 'GET' ? bodyStr : undefined,
    });

    const json = await res.json();
    if (json.code !== '00000') {
      throw new Error(json.msg || `Error ${json.code}`);
    }
    return json.data;
  }

  setSendMessage(fn) {
    this.sendMessage = fn;
  }

  // ---- v3 leverage ----
  async setLeverage(symbol, leverage, holdSide = 'long') {
    try {
      const res = await this.request(
        'POST',
        '/api/v3/mix/account/set-leverage',
        {},
        {
          category: this.category,
          symbol,
          leverage: String(leverage),
          marginMode: this.config.marginMode || 'isolated',
          holdSide, // 'long' | 'short'
        }
      );

      this.logger.info(`Leverage set to ${leverage}x for ${symbol} (${holdSide})`);
      this.sendMessage?.(`✅ Leverage set to ${leverage}x for ${symbol} (${holdSide})`);
      return true;
    } catch (e) {
      this.logger.error('Failed to set leverage', e);
      this.sendMessage?.(`❌ Failed to set leverage: ${e.message}`);
      return false;
    }
  }

  // ---- v3 place order ----
  async placeOrder(side, qty, tradeSide = 'open', positionSide = 'long') {
    try {
      const res = await this.request(
        'POST',
        '/api/v3/mix/order/place-order',
        {},
        {
          category: this.category,
          symbol: this.config.symbol,
          marginMode: this.config.marginMode || 'isolated',
          side: side.toLowerCase(), // buy | sell
          orderType: 'market',
          size: String(qty),
          reduceOnly: false,
          tradeSide, // open | close
          positionSide, // long | short
          force: 'gtc',
        }
      );

      this.logger.info(`Order placed: ${side} ${qty} (${tradeSide} ${positionSide})`, res);
      this.sendMessage?.(`🟢 Order: ${side} ${qty} (${tradeSide} ${positionSide})`);
      return res;
    } catch (e) {
      this.logger.error('Order failed', e);
      this.sendMessage?.(`❌ Order failed: ${e.message}`);
      throw e;
    }
  }

  // ---- v3 cancel all ----
  async cancelAllOrders() {
    try {
      const res = await this.request(
        'POST',
        '/api/v3/mix/order/cancel-all',
        {},
        {
          category: this.category,
          symbol: this.config.symbol,
        }
      );

      this.logger.info(`✅ All open orders canceled for ${this.config.symbol}`);
      this.sendMessage?.(`🧹 All open orders canceled for *${this.config.symbol}*`);
      return res;
    } catch (e) {
      this.logger.error('Failed to cancel open orders', e);
      this.sendMessage?.(`❌ Failed to cancel open orders: ${e.message}`);
      throw e;
    }
  }

  // ---- wrappers ----
  async openMainTrade(side, qty) {
    const positionSide = side.toUpperCase() === 'BUY' ? 'long' : 'short';
    const success = await this.setLeverage(this.config.symbol, this.config.leverage, positionSide);
    if (!success) throw new Error('Leverage setup failed');
    return this.placeOrder(side, qty, 'open', positionSide);
  }

  async closeMainTrade(side, qty) {
    const positionSide = side.toUpperCase() === 'BUY' ? 'long' : 'short';
    const closeSide = side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY';
    return this.placeOrder(closeSide, qty, 'close', positionSide);
  }

  async openHedgeTrade(side, qty) {
    return this.openMainTrade(side, qty);
  }

  async closeHedgeTrade(side, qty) {
    return this.closeMainTrade(side, qty);
  }
}

const bitgetClient = new BitgetClient();
module.exports = bitgetClient;
