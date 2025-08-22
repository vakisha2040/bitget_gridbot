// tradingBotBitget.js
const axios = require("axios");

// ---- Config ----
const SYMBOL = "BTCUSDT_UMCBL"; // BTC/USDT USDT-M Futures
const GRANULARITY = 60; // 1 minute candles (in seconds)
const LIMIT = 50; // fetch 50 candles for safety

// ---- Fetch candles ----
async function fetchCandles() {
  try {
    const url = `https://api.bitget.com/api/mix/v1/market/candles?symbol=${SYMBOL}&granularity=${GRANULARITY}&limit=${LIMIT}`;
    const { data } = await axios.get(url);

    // Bitget returns: [timestamp, open, high, low, close, volume, quoteVolume]
    const candles = data.map(c => ({
      openTime: Number(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      time: new Date(Number(c[0])).toLocaleTimeString()
    })).reverse(); // reverse so earliest → latest

    return candles;
  } catch (err) {
    console.error("❌ Request failed:", err.message);
    return [];
  }
}

// ---- Intraday signal logic ----
function getIntradaySignal(candles) {
  if (candles.length < 11) return "WAIT";

  const recent10 = candles.slice(-11, -1); // Previous 10 candles
  const last = candles[candles.length - 1];

  const high10 = Math.max(...recent10.map(c => c.high));
  const low10 = Math.min(...recent10.map(c => c.low));

  // Debug
  console.log(`Last: ${last.close}, H10: ${high10}, L10: ${low10}`);

  if (last.close >= high10) {
    console.log(`📈 BUY at ${last.close} on ${last.time}`);
    return "BUY";
  }

  if (last.close <= low10) {
    console.log(`📉 SELL at ${last.close} on ${last.time}`);
    return "SELL";
  }

  return "WAIT";
}

// ---- Analyze and log every interval ----
async function analyze() {
  const candles = await fetchCandles();
  if (!candles.length) {
    console.log("No candle data, skipping.");
    return "WAIT";
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
    console.error("❌ Error:", err.message);
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

// ---- Notes ----
// - Change SYMBOL and GRANULARITY for your preferred contract/timeframe.
// - No API key needed for public market data.
// - For live trading, you’ll need authentication & order placement logic.
