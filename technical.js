const axios = require('axios');
const config = require('./config.json');

const SYMBOL = config.symbol.endsWith('_UMCBL') ? config.symbol : config.symbol + '_UMCBL';
const INTERVAL = '3m';
const LIMIT = 100;

let currentPosition = null; // 'LONG', 'SHORT', or null

function getBitgetInterval(binanceInterval) {
  // Bitget uses '1m', '3m', etc.
  if (/^\d+m$/.test(binanceInterval)) {
    return binanceInterval;
  }
  throw new Error('Unsupported interval format for Bitget');
}

async function fetchCandles(symbol = SYMBOL) {
  // Bitget endpoint for USDT Perpetual Kline
  // https://api.bitget.com/api/v2/market/mark-candles?symbol=BTCUSDT_UMCBL&granularity=3m&limit=100
  const bitgetInterval = getBitgetInterval(INTERVAL);
  const url = `https://api.bitget.com/api/v2/market/mark-candles?symbol=${symbol}&granularity=${bitgetInterval}&limit=${LIMIT}`;
  const res = await axios.get(url);
  // Bitget returns { code, msg, data: [[timestamp, open, high, low, close, ...], ...] }
  if (!res.data.data) {
    throw new Error('Invalid response from Bitget API');
  }
  // Bitget data order: [timestamp, open, high, low, close, volume, turnover]
  return res.data.data.map(c => ({
    openTime: Number(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    time: new Date(Number(c[0])).toLocaleTimeString()
  })).reverse(); // Bitget returns newest first, reverse for oldest first
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
  const signal = getIntradaySignal(candles);
  console.log(`[${new Date().toLocaleString()}] 📊 Signal: ${signal}`);
  
  return signal;
}

// Run every 5 seconds
setInterval(async () => {
  try {
    await analyze();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}, 5000); // Poll every 5 sec 

module.exports = { analyze };

/*
usage

const { analyze } = require('./technical');

(async () => {
  let signal = await analyze();
  console.log("Signal received:", signal);
})();
*/
