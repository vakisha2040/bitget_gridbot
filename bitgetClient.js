require('dotenv').config();
const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('./config.json');

class BitgetClient {
  constructor(cfg = config, logger = console) {
    this.config = cfg;
    this.logger = logger;
    this.sendMessage = () => {};
    this.baseURL = 'https://api.bitget.com';
    this.apiKey = process.env.BITGET_API_KEY;
    this.apiSecret = process.env.BITGET_API_SECRET;
    this.passphrase = process.env.BITGET_API_PASSPHRASE;
  }

  setSendMessage(fn) {
    this.sendMessage = fn;
  }

  // ---- signing helper ----
  sign(timestamp, method, path, body = '') {
    const msg = `${timestamp}${method}${path}${body}`;
    return crypto.createHmac('sha256', this.apiSecret).update(msg).digest('base64');
  }

  async request(method, path, params = {}, body = null) {
    const timestamp = Date.now().toString();
    const query = method === 'GET' && Object.keys(params).length
      ? '?' + new URLSearchParams(params)
      : '';
    const fullPath = `${path}${query}`;
    const url = this.baseURL + fullPath;
    const bodyStr = body ? JSON.stringify(body) : '';
    const sign = this.sign(timestamp, method, fullPath, bodyStr);

    const res = await fetch(url, {
      method,
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : bodyStr,
    });

    const json = await res.json();
    if (json.code !== '00000') {
      throw new Error(json.msg || JSON.stringify(json));
    }
    return json.data;
  }

  // ---- Account Setup ----
  async setMarginMode(mode = 'crossed') {
    try {
      await this.request('POST', '/api/mix/v1/account/setMarginMode', {}, {
        marginCoin: this.config.marginCoin,
        productType: this.config.productType,
        marginMode: mode
      });
      this.logger.info(`✅ Margin mode set to ${mode}`);
    } catch (e) {
      this.logger.error('❌ Set margin mode failed:', e.message);
    }
  }

  async setPositionMode(mode = 'double_hold') {
    try {
      await this.request('POST', '/api/mix/v1/account/setPositionMode', {}, {
        marginCoin: this.config.marginCoin,
        productType: this.config.productType,
        holdMode: mode
      });
      this.logger.info(`✅ Position mode set to ${mode}`);
    } catch (e) {
      this.logger.error('❌ Set position mode failed:', e.message);
    }
  }

  async setLeverage(symbol, leverage, marginMode = 'crossed') {
    try {
      await this.request('POST', '/api/mix/v1/account/setLeverage', {}, {
        symbol,
        marginCoin: this.config.marginCoin,
        leverage: String(leverage),
        marginMode
      });
      this.logger.info(`✅ Leverage set: ${leverage}x ${symbol} (${marginMode})`);
      return true;
    } catch (e) {
      this.logger.error('❌ Set leverage failed:', e.message);
      return false;
    }
  }

  // ---- Place Order (Hedge Mode) ----
  async placeOrder(side, qty) {
    try {
      let orderSide, holdSide;

      if (side.toUpperCase() === 'BUY') {
        orderSide = 'open_long';
        holdSide = 'long';
      } else if (side.toUpperCase() === 'SELL') {
        orderSide = 'open_short';
        holdSide = 'short';
      } else if (side.toUpperCase() === 'CLOSE_LONG') {
        orderSide = 'close_long';
        holdSide = 'long';
      } else if (side.toUpperCase() === 'CLOSE_SHORT') {
        orderSide = 'close_short';
        holdSide = 'short';
      } else {
        throw new Error(`Invalid side: ${side}`);
      }

      const order = await this.request('POST', '/api/mix/v1/order/placeOrder', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: String(qty),
        side: orderSide,
        holdSide: holdSide,
        orderType: 'market',
      });

      this.logger.info(`🟢 Order placed: ${orderSide} ${qty}`, order);
      this.sendMessage?.(`🟢 Order placed: ${orderSide} ${qty}`);
      return order;
    } catch (e) {
      this.logger.error('❌ Order failed:', e.message);
      throw e;
    }
  }

  // ---- Cancel All Orders ----
  async cancelAllOrders() {
    try {
      await this.request('POST', '/api/mix/v1/order/cancel-all', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
      });
      this.logger.info(`✅ All orders canceled for ${this.config.symbol}`);
      this.sendMessage?.(`🧹 All orders canceled for ${this.config.symbol}`);
    } catch (e) {
      this.logger.error('❌ Cancel orders failed:', e.message);
    }
  }

  // ---- Hedge wrappers ----
  async openHedgeTrade(side, qty) {
    return this.placeOrder(side, qty);
  }

  async closeHedgeTrade(side, qty) {
    return this.placeOrder(side, qty);
  }
}

const bitgetClient = new BitgetClient();
module.exports = bitgetClient;


//usage example
/*
// setup account
await bitgetClient.setMarginMode('crossed');
await bitgetClient.setPositionMode('double_hold');
await bitgetClient.setLeverage('BTCUSDT', 20, 'crossed');

// open long
await bitgetClient.openHedgeTrade('BUY', 0.01);

// open short
await bitgetClient.openHedgeTrade('SELL', 0.01);

// close long
await bitgetClient.closeHedgeTrade('CLOSE_LONG', 0.01);

// close short
await bitgetClient.closeHedgeTrade('CLOSE_SHORT', 0.01);
*/
