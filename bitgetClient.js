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

  /*
  // ---- Set Leverage ----
  async setLeverage(symbol, leverage, marginMode = 'isolated') {
    try {
      await this.request('POST', '/api/v3/mix/account/set-leverage', {}, {
        symbol,
        marginCoin: this.config.marginCoin,
        marginMode,
        leverage: String(leverage),
      });
      this.logger.info(`✅ Leverage set: ${leverage}x ${symbol} (${marginMode})`);
      this.sendMessage?.(`✅ Leverage set: ${leverage}x ${symbol} (${marginMode})`);
      return true;
    } catch (e) {
      this.logger.error('❌ Set leverage failed:', e.message);
      return false;
    }
  }

  // ---- Place Order ----
  async placeOrder(side, qty, tradeSide = 'open', positionSide = 'long') {
    try {
      const order = await this.request('POST', '/api/v3/mix/order/place-order', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        marginMode: this.config.marginMode || 'isolated',
        size: String(qty),
        side: side.toLowerCase(),   // buy/sell
        tradeSide,                  // open/close
        orderType: 'market',
        force: 'gtc',
      });
      this.logger.info(`🟢 Order placed: ${side} ${qty} (${tradeSide}/${positionSide})`, order);
      this.sendMessage?.(`🟢 Order placed: ${side} ${qty} (${tradeSide}/${positionSide})`);
      return order;
    } catch (e) {
      this.logger.error('❌ Order failed:', e.message);
      throw e;
    }
  }

  // ---- Cancel All Orders ----
  async cancelAllOrders() {
    try {
      await this.request('POST', '/api/v3/mix/order/cancel-all', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
      });
      this.logger.info(`✅ All orders canceled for ${this.config.symbol}`);
      this.sendMessage?.(`🧹 All orders canceled for ${this.config.symbol}`);
    } catch (e) {
      this.logger.error('❌ Cancel orders failed:', e.message);
    }
  }
*/
  
  // ---- Open Main Trade ----
  async openMainTrade(side, qty) {
    const posSide = side.toUpperCase() === 'BUY' ? 'long' : 'short';
    await this.setLeverage(this.config.symbol, this.config.leverage, this.config.marginMode);
    return this.placeOrder(side, qty, 'open', posSide);
  }

  // ---- Close Main Trade ----
  async closeMainTrade(side, qty) {
    const posSide = side.toUpperCase() === 'BUY' ? 'long' : 'short';
    const closeSide = side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY';
    return this.placeOrder(closeSide, qty, 'close', posSide);
  }

  // ---- Hedge wrappers ----
  async openHedgeTrade(side, qty) {
    return this.openMainTrade(side, qty);
  }
  

  async closeHedgeTrade(side, qty) {
    return this.closeMainTrade(side, qty);
  }
}

const bitgetClient = new BitgetClient();
module.exports = bitgetClient;
