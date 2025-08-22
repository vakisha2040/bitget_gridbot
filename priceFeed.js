const axios = require('axios');
const config = require('./config.json');

let latestPrice = 0;
let listeners = [];
let pollingInterval = null;

// Bitget API v3 endpoint
async function pollPrice() {
  try {
    const endpoint = `https://api.bitget.com/api/v2/market/ticker`;
    const params = {
      symbol: config.symbol // e.g. "BTCUSDT"
    };

    const res = await axios.get(endpoint, { params });

    if (res.data.code !== "00000") {
      throw new Error(res.data.msg || "Unknown Bitget API error");
    }

    const ticker = res.data?.data;
    if (!ticker) {
      throw new Error("No ticker data");
    }

    const price = ticker.lastPr || ticker.close;
    if (price) {
      latestPrice = parseFloat(price);
      listeners.forEach(fn => fn(latestPrice));
    } else {
      console.warn("[Bitget] No valid price found in response:", ticker);
    }

  } catch (err) {
    console.error("[PriceFeed] Bitget polling error:", err.message);
  }
}

function startPolling(intervalMs = 1000) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollPrice(); // immediate
  pollingInterval = setInterval(pollPrice, intervalMs);
}

function stopPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = null;
}

function onPrice(callback) {
  listeners.push(callback);
  if (latestPrice) callback(latestPrice);
}

function getCurrentPrice() {
  return latestPrice;
}

function waitForFirstPrice() {
  return new Promise(resolve => {
    if (latestPrice) return resolve(latestPrice);
    onPrice(resolve);
  });
}

module.exports = {
  onPrice,
  getCurrentPrice,
  waitForFirstPrice,
  startPolling,
  stopPolling
};
