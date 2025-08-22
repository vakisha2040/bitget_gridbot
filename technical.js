const axios = require('axios');

// ---- CONFIGURATION ----
// Change these values as needed for your contract and time frame
const SYMBOL = 'BTCUSDT_UMCBL'; // Bitget USDT-Margined perpetual futures symbol
const GRANULARITY = 180;     // Candle interval: '1min', '5min', '15min', '30min', '1h', etc.
const LIMIT = 100;              // Number of candles to fetch (1-1000)

// ---- Fetch candles from Bitget Futures API ----
async function fetchCandles(symbol = SYMBOL) {
  const url = 'https://api.bitget.com/api/mix/v1/market/candles';
  try {
    const res = await axios.get(url, {
      params: {
        symbol,
        granularity: GRANULARITY,
        limit: LIMIT
        // Do NOT include productType or other unnecessary params
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
      volume: parseFloat(c[5]),
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

// ---- Notes ----
// - Change SYMBOL and GRANULARITY for your preferred contract/timeframe.
// - No API key needed for public data.
// - For real trading, add authentication and order logic.
