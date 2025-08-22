// tradingBotBitget.js
const axios = require("axios");

// ---- Config ----
const CATEGORY = "USDT-FUTURES";   // SPOT | USDT-FUTURES | COIN-FUTURES | USDC-FUTURES
const SYMBOL = "BTCUSDT";          // plain symbol (no _UMCBL in v3)
const INTERVAL = "1m";             // 1m,3m,5m,15m,30m,1H,4H,6H,12H,1D
const LIMIT = 100;                 // v3 max per page is 100

// ---- Fetch candles (v3 UTA) ----
async function fetchCandles() {
  const url = "https://api.bitget.com/api/v3/market/candles";
  try {
    const { data } = await axios.get(url, {
      params: {
        category: CATEGORY,
        symbol: SYMBOL,
        interval: INTERVAL,      // (docs sometimes say granularity; use interval here)
        type: "MARKET",          // MARKET | MARK | INDEX (default MARKET)
        limit: LIMIT
      },
      timeout: 10000
    });

    if (data?.code !== "00000") {
      throw new Error(`${data?.code || "ERR"} ${data?.msg || "Unknown error"}`);
    }

    // data.data is an array of arrays:
    // [timestamp(ms), open, high, low, close, volume(base), turnover(quote)]
    const candles = (data.data || []).map(c => ({
      openTime: Number(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      time: new Date(Number(c[0])).toLocaleTimeString()
    }));

    // Bitget often returns latest-first; sort to oldest->newest for consistent slicing
    candles.sort((a, b) => a.openTime - b.openTime);
    return candles;
  } catch (err) {
    console.error("❌ Request failed:", err.response?.data || err.message);
    return [];
  }
}

// ---- Intraday signal logic ----
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

// ---- Analyze and log every interval ----
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

// ---- Run every 5 seconds (5000 ms) ----
setInterval(async () => {
  try {
    await analyze();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}, 5000);

// ---- Export for external usage ----
module.exports = {
  analyze,
  fetchCandles,
  getIntradaySignal
};

/*
USAGE:
const { analyze } = require('./tradingBotBitget');

(async () => {
  let signal = await analyze();
  console.log("Signal received:", signal);
})();
*/
