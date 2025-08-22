const axios = require("axios");
const config = require("./config.json");

let latestPrice = 0;
let listeners = [];
let pollingInterval = null;

// ✅ Correct Bitget UTA v3 Ticker endpoint
async function pollPrice() {
  try {
    const endpoint = `https://api.bitget.com/api/v2/mix/market/ticker`;
    const params = {
      symbol: config.polsymbol,   // e.g. "BTCUSDT"
      productType: "umcbl"        // UMCBL = USDT-M Futures
    };

    const res = await axios.get(endpoint, { params });

    if (res.data.code !== "00000") {
      throw new Error(res.data.msg || "Unknown Bitget API error");
    }

    const ticker = res.data?.data;
    const price = ticker.last; // ✅ last traded price

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
