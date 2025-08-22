const axios = require('axios');
const config = require('./config.json');

// Make sure config.symbol is a valid Bitget futures symbol like "BTCUSDT", "SOLUSDT", etc.
const SYMBOL = config.symbol || "BTCUSDT";
const INTERVAL = '3m'; // Must be a string per docs ("1m", "3m", etc.)
const LIMIT = 100;
const PRODUCT_TYPE = "USDT-FUTURES"; // Use "USDT-FUTURES" for USDT-Margined Perpetual

async function fetchCandles(symbol = SYMBOL) {
  const url = 'https://api.bitget.com/api/v2/mix/market/candles';
  try {
    const res = await axios.get(url, {
      params: {
        symbol: symbol,
        productType: PRODUCT_TYPE,
        granularity: INTERVAL,
        limit: LIMIT,
      }
    });
    if (!res.data.data || !Array.isArray(res.data.data) || res.data.data.length === 0) {
      throw new Error("Empty data: " + JSON.stringify(res.data));
    }
    // Parse and reverse to go from oldest -> newest
    return res.data.data.reverse().map(c => ({
      openTime: Number(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      time: new Date(Number(c[0])).toLocaleTimeString()
    }));
  } catch (err) {
    // Print detailed error for debugging
    if (err.response) {
      console.error('❌ fetchCandles error:', err.response.data);
    } else {
      console.error('❌ fetchCandles error:', err.message);
    }
    return [];
  }
}

function getIntradaySignal(candles) {
  if (candles.length < 11) return 'WAIT';

  const recent10 = candles.slice(-11, -1); // Previous 10 candles
  const last = candles[candles.length - 1];

  const high10 = Math.max(...recent10.map(c => c.high));
  const low10 = Math.min(...recent10.map(c => c.low));

  // Debug
  console.log(`Last: ${last.close}, H10: ${high10}, L10: ${low10}`);

  if (last.close >= high10) {
    console.log(`📈 BUY at ${last.close} on ${last.time}`);
    return 'BUY';
  }

  if (last.close <= low10) {
    console.log(`📉 SELL at ${last.close} on ${last.time}`);
    return 'SELL';
  }

  return 'WAIT';
}

async function analyze() {
  const candles = await fetchCandles();
  if (!candles.length) {
    console.log('No candle data, skipping.');
    return 'WAIT';
  }
  const signal = getIntradaySignal(candles);
  console.log(`[${new Date().toLocaleString()}] 📊 Signal: ${signal}`);
  return signal;
}

// Run every 5 minutes (300000 ms)
setInterval(async () => {
  try {
    await analyze();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}, 300000);

module.exports = { analyze };

/*
usage

const { analyze } = require('./tradingBotBitget');

(async () => {
  let signal = await analyze();
  console.log("Signal received:", signal);
})();
*/
