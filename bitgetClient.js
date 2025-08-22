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

  validateSide(side) {
    if (!['BUY', 'SELL'].includes(side)) {
      throw new Error(`Invalid side: ${side}`);
    }
  }

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

  async enableHedgeMode() {
    await this.setMarginMode('crossed');
    await this.setPositionMode('double_hold');
  }

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

  // Open main trade (hedge mode: positionSide = LONG or SHORT)
  async openMainTrade(side, qty) {
    try {
      side = String(side).toUpperCase();
      this.validateSide(side);
      await this.enableHedgeMode();
      await this.setLeverage(this.config.symbol, this.config.leverage);

      // Hedge mode: LONG for BUY, SHORT for SELL
      const positionSide = side === 'BUY' ? 'long' : 'short';

      const order = await this.request('POST', '/api/mix/v1/order/placeOrder', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: String(qty),
        side: side === 'BUY' ? 'open_long' : 'open_short',
        holdSide: positionSide,
        orderType: 'market',
      });

      this.logger.info(`Main trade opened: ${side} ${qty} (${positionSide})`, order);
      this.sendMessage?.(`📈 Main trade opened: ${side} ${qty} (${positionSide})`);
      return order;
    } catch (e) {
      this.logger.error('Failed to open main trade', e);
      this.sendMessage?.(`❌ Failed to open main trade: ${e.message}`);
      throw e;
    }
  }

  // Close main trade (hedge mode: positionSide = LONG or SHORT, opposite side)
  async closeMainTrade(side, qty) {
    try {
      side = String(side).toUpperCase();
      this.validateSide(side);
      await this.enableHedgeMode();

      const positionSide = side === 'BUY' ? 'long' : 'short';
      const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

      // Check position before closing (Bitget open positions endpoint)
      const positions = await this.getPositions();
      const pos = positions.find(p => p.holdSide && p.holdSide.toLowerCase() === positionSide);
      if (!pos || Number(pos.total) === 0) {
        this.logger.info(`No position to close on ${positionSide}`);
        this.sendMessage?.(`ℹ️ No ${positionSide} position to close.`);
        return null;
      }

      const closeQty = Math.min(Math.abs(Number(pos.total)), Number(qty));

      const order = await this.request('POST', '/api/mix/v1/order/placeOrder', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: String(closeQty),
        side: closeSide === 'BUY' ? 'close_long' : 'close_short',
        holdSide: positionSide,
        orderType: 'market',
      });

      this.logger.info(`Main trade closed: ${closeSide} ${closeQty} (${positionSide})`, order);
      this.sendMessage?.(`❌ Main trade closed: ${closeSide} ${closeQty} (${positionSide})`);
      return order;
    } catch (e) {
      this.logger.error('Failed to close main trade', e);
      this.sendMessage?.(`❌ Failed to close main trade: ${e.message}`);
      throw e;
    }
  }

  // Open hedge trade (hedge mode: positionSide = LONG or SHORT)
  async openHedgeTrade(side, qty) {
    try {
      side = String(side).toUpperCase();
      this.validateSide(side);
      await this.enableHedgeMode();
      await this.setLeverage(this.config.symbol, this.config.leverage);

      const positionSide = side === 'BUY' ? 'long' : 'short';

      const order = await this.request('POST', '/api/mix/v1/order/placeOrder', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: String(qty),
        side: side === 'BUY' ? 'open_long' : 'open_short',
        holdSide: positionSide,
        orderType: 'market',
      });

      this.logger.info(`Hedge trade opened: ${side} ${qty} (${positionSide})`, order);
      this.sendMessage?.(`🛡️ Hedge trade opened: ${side} ${qty} (${positionSide})`);
      return order;
    } catch (e) {
      this.logger.error('Failed to open hedge trade', e);
      this.sendMessage?.(`❌ Failed to open hedge trade: ${e.message}`);
      throw e;
    }
  }

  // Close hedge trade (hedge mode: positionSide = LONG or SHORT, opposite side)
  async closeHedgeTrade(side, qty) {
    try {
      side = String(side).toUpperCase();
      this.validateSide(side);
      await this.enableHedgeMode();

      const positionSide = side === 'BUY' ? 'long' : 'short';
      const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

      // Check position before closing
      const positions = await this.getPositions();
      const pos = positions.find(p => p.holdSide && p.holdSide.toLowerCase() === positionSide);
      if (!pos || Number(pos.total) === 0) {
        this.logger.info(`No position to close on ${positionSide}`);
        this.sendMessage?.(`ℹ️ No ${positionSide} position to close.`);
        return null;
      }

      const closeQty = Math.min(Math.abs(Number(pos.total)), Number(qty));

      const order = await this.request('POST', '/api/mix/v1/order/placeOrder', {}, {
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: String(closeQty),
        side: closeSide === 'BUY' ? 'close_long' : 'close_short',
        holdSide: positionSide,
        orderType: 'market',
      });

      this.logger.info(`Hedge trade closed: ${closeSide} ${closeQty} (${positionSide})`, order);
      this.sendMessage?.(`❌ Hedge trade closed: ${closeSide} ${closeQty} (${positionSide})`);
      return order;
    } catch (e) {
      this.logger.error('Failed to close hedge trade', e);
      this.sendMessage?.(`❌ Failed to close hedge trade: ${e.message}`);
      throw e;
    }
  }

  // Helper to get positions for configured symbol
  async getPositions() {
    const positions = await this.request(
      'GET',
      '/api/mix/v1/position/singlePosition',
      { symbol: this.config.symbol, marginCoin: this.config.marginCoin }
    );
    // positions might be array or object depending on API response
    return Array.isArray(positions) ? positions : [positions];
  }

  // Cancel all open orders for the configured symbol
  async cancelAllOrders(symbol = this.config.symbol) {
    try {
      await this.request('POST', '/api/mix/v1/order/cancel-all', {}, {
        symbol,
        marginCoin: this.config.marginCoin,
      });
      this.logger.info(`✅ All open orders canceled for ${symbol}`);
      this.sendMessage?.(`🧹 All open orders canceled for *${symbol}*`);
    } catch (err) {
      this.logger.error(`❌ Failed to cancel open orders for ${symbol}:`, err);
      this.sendMessage?.(`❌ Failed to cancel open orders: ${err.message}`);
      throw err;
    }
  }
}

const bitgetClient = new BitgetClient();
module.exports = bitgetClient;
