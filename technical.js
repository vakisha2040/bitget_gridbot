const axios = require('axios');
const config = require('./config.json');

// Example: "SBTCSUSDT", "SBTCSUSDT", etc.
const SYMBOL = config.symbol || "SBTCSUSDT";
const INTERVAL_SECONDS = 180; // 3 minutes
const LIMIT = 100;
const PRODUCT_TYPE = "umcbl"; // USDT-M futures

let currentPosition = null; // 'LONG', 'SHORT', or null

async function fetchCandles(symbol = SYMBOL) {
  const url = 'https://api.bitget.com/api/mix/v1/market/candles';
  try {
    const res = await axios.get(url, {
      params: {
        symbol: symbol,
        granularity: INTERVAL_SECONDS,
        limit: LIMIT,
        productType: PRODUCT_TYPE
      }
    });
    // Bitget returns: [time, open, high, low, close, volume, quoteVolume]
    return res.data.data.reverse().map(c => ({
      openTime: Number(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      time: new Date(Number(c[0])).toLocaleTimeString()
    }));
  } catch (err) {
    console.error('❌ fetchCandles error:', err.message);
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

// Run every 5 sec (5000 ms)
setInterval(async () => {
  try {
    await analyze();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}, 5000);

module.exports = { analyze };

/*
usage

const { analyze } = require('./tradingBotBitget');

(async () => {
  let signal = await analyze();
  console.log("Signal received:", signal);
})();
*/
