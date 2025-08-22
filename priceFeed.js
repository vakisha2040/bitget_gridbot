const axios = require('axios');
const config = require('./config.json');

let latestPrice = 0;
let listeners = [];
let pollingInterval = null;

// Bitget UTA v3 ticker endpoint
// Docs: https://www.bitget.com/api-doc/contract/market/Get-Ticker
async function pollPrice() {
  try {
    const endpoint = `https://api.bitget.com/api/v2/market/ticker`;

    const res = await axios.get(endpoint, {
      params: {
        symbol: config.polsymbol // e.g. "BTCUSDT_UMCBL"
      }
    });

    if (res.data.code !== "00000") {
      throw new Error(res.data.msg || "Bitget API error");
    }

    const ticker = res.data.data;
    if (!ticker || !ticker.lastPr) {
      console.warn("[Bitget] No valid price found:", res.data);
      return;
    }

    const price = parseFloat(ticker.lastPr);
    if (price) {
      latestPrice = price;
      listeners.forEach(fn => fn(latestPrice));
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
