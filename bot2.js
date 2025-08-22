const {
  calculateNextPrice,
  calculateStopLoss,
  fetchPrecision,
  toPrecision,
} = require('./helper');

const priceFeed = require('./priceFeed');
const { stopPolling, getCurrentPrice, startPolling, onPrice, waitForFirstPrice } = priceFeed;

const bitgetClient = require('./bitgetClient');
const config = require('./config.json');
const state = require('./state');
const { clearBoundary, loadBoundary, saveBoundary } = require('./persistence');
const { analyze } = require('./technical');

let sendMessage = () => {};
function setSendMessage(fn) {
  sendMessage = fn;
  bitgetClient.setSendMessage(sendMessage);
}

// -- Load boundary state on startup
let { trailingBoundary, boundaries } = loadBoundary();
if (!boundaries){
  boundaries = { top: null, bottom: null };
}
let lastClose = null;
let lastHedgeClosePrice = null;
let hedgeCooldownUntil = 0;
let mainCooldownUntil = 0;
let sentReadyTrigger = false;
let sentKillTrigger = false;
const BOUNDARY_UPDATE_INTERVAL = 20000;
let lastSetBoundary = null;
let preKillStartTime = null;
let lastKillResetTime = 0;
let hedgeOpeningInProgress = false;
let boundaryLocked = false;
let maintainedDistance = config.constantTrailingDistance;

function getGridSpacing(level) {
  if (level === 0) return config.zeroLevelSpacing;
  return config.gridSpacing;
}

async function initializeBitgetAccount() {
  await bitgetClient.setMarginMode('crossed');
  await bitgetClient.setPositionMode('double_hold');
  await bitgetClient.setLeverage(config.symbol, config.leverage, 'crossed');
}

async function startBot() {
  fetchPrecision(config);
  startPolling(2000);

  onPrice(price => {
    console.log("✅ Live price:", price);
  });

  const firstPrice = await waitForFirstPrice();
  console.log("🎯 First price fetched:", firstPrice);

  // Bitget account setup (run once per session)
  await initializeBitgetAccount();

  state.startBot();
  sendMessage('🤖 Bot started');
  
  const mainTrade = state.getMainTrade();
  const hedgeTrade = state.getHedgeTrade();

  if (mainTrade) {
    sendMessage(`📦 Resuming main trade: ${mainTrade.side} from ${mainTrade.entry} at level ${mainTrade.level}`);
  } 
  else if (hedgeTrade) {
    sendMessage(`🛡️ Found existing hedge trade - promoting to main`);
  }
  else {
    const price = getCurrentPrice();
    if (!price) {
      sendMessage("⚠️ Unable to fetch price for main trade on startup.");
      return;
    }
    const signal =  await analyze();
    if (signal === 'BUY') {
      sendMessage(` 🕐 Signal is BUY, Placing Buy order...`);
      await openMainTrade('Buy', price);
    } 
    else if (signal === 'SELL') {
      sendMessage(` 🕐 Signal is SELL, Placing sell order...`);
      await openMainTrade('Sell', price);
    }
  }

  monitorPrice();
}

async function openMainTrade(side, entryPrice) {
  try {
    // Bitget: Open main trade using hedge wrapper (actual side logic handled in bitgetClient)
    await bitgetClient.openHedgeTrade(side.toUpperCase(), config.orderSize);

    state.setMainTrade({
      side,
      entry: entryPrice,
      level: 0,
      hedge: false,
      gridLevels: [],
      stopLoss: null,
      timestamp: Date.now(),
      killTriggered: false,
      armedNotificationSent: false,
      breakthroughPrice: null,
    });
    boundaryLocked = true;
    sendMessage(`📈 Main trade opened: ${side} at ${entryPrice}`);
    await initializeBoundaries();
  } catch (e) {
    sendMessage(`❌ Failed to open main trade: ${e.message}`);
  }
}

async function closeMainTrade(price, manual = false) {
  try {
    const mainTrade = state.getMainTrade();
    if (!mainTrade) return;

    // Bitget: Close main trade
    const side = mainTrade.side === 'Buy' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    await bitgetClient.closeHedgeTrade(side, config.orderSize);

    sendMessage(`✅ ${mainTrade.side} trade closed at ${price}${manual ? ' (manual)' : ''}`);
    state.clearMainTrade();
    boundaryLocked = false;

    // Always promote hedge to main if it exists
    if (state.getHedgeTrade()) {
      await promoteHedgeToMain(price);
    } else {
      mainCooldownUntil = 0;
      await initializeFreshBoundaries();
    }
  } catch (e) {
    sendMessage(`❌ Close failed: ${e.message}`);
  }
}

async function openHedgeTrade(side, entryPrice) {
  if (state.getHedgeTrade()) {
    sendMessage(`⚠️ Attempt to open duplicate hedge ignored.`);
    return;
  }

  try {
    let breakthroughPrice = null;
    if (side === 'Buy') {
      breakthroughPrice = toPrecision(entryPrice + 0.5 * config.zeroLevelSpacing);
    } else {
      breakthroughPrice = toPrecision(entryPrice - 0.5 * config.zeroLevelSpacing);
    }
    await bitgetClient.openHedgeTrade(side.toUpperCase(), config.orderSize);

    state.setHedgeTrade({
      side,
      entry: entryPrice,
      level: 0,
      hedge: true,
      gridLevels: [],
      stopLoss: null,
      breakthroughPrice,
      timestamp: Date.now(),
      killTriggered: false,
      armedNotificationSent: false,
    });
    sendMessage(`🛡️ Hedge trade opened: ${side} at ${entryPrice} (Breakthrough: ${breakthroughPrice})`);
  } catch (e) {
    sendMessage(`❌ Failed to open hedge trade: ${e.message}`);
  }
}

async function closeHedgeTrade(price, manual = false) {
  try {
    const hedgeTrade = state.getHedgeTrade();
    if (!hedgeTrade) return;

    const side = hedgeTrade.side === 'Buy' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    await bitgetClient.closeHedgeTrade(side, config.orderSize);

    sendMessage(`❌ Hedge trade closed: ${hedgeTrade.side} ${config.orderSize} (${hedgeTrade.side === 'Buy' ? 'LONG' : 'SHORT'})`);
    sendMessage(`❌ Hedge trade closed at ${price}${manual ? ' (manual)' : ''}`);
    state.clearHedgeTrade();
    boundaryLocked = false;
    await initializeNewHedgeBoundaries();
  } catch (e) {
    sendMessage(`❌ Failed to close hedge trade: ${e.message}`);
  }
}

async function promoteHedgeToMain(price) {
  const hedge = state.getHedgeTrade();
  if (!hedge) return;
  hedge.level = 0;
  hedge.hedge = false;
  hedge.stopLoss = null;
  hedge.openTimestamp = null;
  state.setMainTrade(hedge);
  boundaryLocked = false;
  sendMessage('🔁 Hedge trade promoted to main trade. Grid reset and stop loss cleared.');
  state.clearHedgeTrade();
  await initializeNewHedgeBoundaries();
  const currentPrice = getCurrentPrice();
  await constantHedgeTrailingBoundary(currentPrice, true, state.getMainTrade());
}

async function monitorPrice() {
  while (state.isRunning()) {
    try {
      const price = getCurrentPrice();
      if (!price) {
        await delay(2000);
        continue;
      }

      const mainTrade = state.getMainTrade();
      const hedgeTrade = state.getHedgeTrade();

      // HEDGE TRADE OPENING LOGIC
      if (!hedgeTrade && !hedgeOpeningInProgress && Date.now() > hedgeCooldownUntil) {
        if (mainTrade?.side === 'Buy' && boundaries.bottom) {
          const effectiveBoundary = boundaries.bottom + config.boundaryTolerance;
          if (price <= effectiveBoundary) {
            hedgeOpeningInProgress = true;
            try {
              await openHedgeTrade('Sell', price);
            } catch (e) {
              sendMessage(`❌ FAILED to open Sell hedge: ${e.message}`);
            } finally {
              hedgeOpeningInProgress = false;
            }
          }
        } else if (mainTrade?.side === 'Sell' && boundaries.top) {
          const effectiveBoundary = boundaries.top - config.boundaryTolerance;
          if (price >= effectiveBoundary) {
            hedgeOpeningInProgress = true;
            try {
              await openHedgeTrade('Buy', price);
            } catch (e) {
              sendMessage(`❌ FAILED to open Buy hedge: ${e.message}`);
            } finally {
              hedgeOpeningInProgress = false;
            }
          }
        }
      }

      // MAIN TRADE HANDLING
      if (mainTrade) {
        await handleMainTrade(price);
      }

      // HEDGE TRADE HANDLING
      if (hedgeTrade) {
        await handleHedgeTrade(price);
      }

      await delay(config.monitorInterval || 1000);

    } catch (e) {
      sendMessage(`‼️ CRITICAL MONITOR ERROR: ${e.message}\n${e.stack}`);
      await delay(2000);
    }
  }
}

async function handleMainTrade(price) { 
  const mainTrade = state.getMainTrade(); 
  if (!mainTrade) return;
  
  const direction = mainTrade.side === 'Buy' ? 1 : -1; 
  const currentLevel = mainTrade.level;
  const nextLevelPrice = toPrecision(
    mainTrade.entry + direction * getGridSpacing(currentLevel) * (currentLevel + 1)
  );

  if ((mainTrade.side === 'Buy' && price >= nextLevelPrice) || 
      (mainTrade.side === 'Sell' && price <= nextLevelPrice)) { 
    mainTrade.level += 1;
    sendMessage(`📊 Main trade reached level ${mainTrade.level} at ${price}`);
    
    if (mainTrade.level >= 1) {
      const prevLevelPrice = mainTrade.entry + direction * getGridSpacing(currentLevel) * currentLevel;
      const currLevelPrice = mainTrade.entry + direction * getGridSpacing(mainTrade.level) * mainTrade.level;
      mainTrade.stopLoss = toPrecision(prevLevelPrice + config.gridStopLossPercent * (currLevelPrice - prevLevelPrice));
      sendMessage(`🔒 Main trade stop loss updated to ${mainTrade.stopLoss}`);
    }
  }

  if (mainTrade.level >= 1 && mainTrade.stopLoss !== null) { 
    if ((mainTrade.side === 'Buy' && price <= mainTrade.stopLoss) || 
        (mainTrade.side === 'Sell' && price >= mainTrade.stopLoss)) { 
      await closeMainTrade(price, false); 
      return; 
    } 
  }

  if (!state.getHedgeTrade() && !hedgeOpeningInProgress && 
      Date.now() > hedgeCooldownUntil && mainTrade.level === 0 && 
      ((mainTrade.side === 'Buy' && price <= boundaries.bottom) || 
       (mainTrade.side === 'Sell' && price >= boundaries.top))) { 
    hedgeOpeningInProgress = true; 
    await openHedgeTrade(mainTrade.side === 'Buy' ? 'Sell' : 'Buy', price); 
    hedgeOpeningInProgress = false; 
  }
}

async function handleHedgeTrade(price) {
  const hedgeTrade = state.getHedgeTrade();
  if (!hedgeTrade) return;

  const direction = hedgeTrade.side === 'Buy' ? 1 : -1;
  const currentLevel = hedgeTrade.level;
  const nextLevelPrice = toPrecision(
    hedgeTrade.entry + direction * getGridSpacing(currentLevel) * (currentLevel + 1)
  );

  if ((hedgeTrade.side === 'Buy' && price >= nextLevelPrice) ||
      (hedgeTrade.side === 'Sell' && price <= nextLevelPrice)) {
    hedgeTrade.level += 1;
    sendMessage(`📊 Hedge trade reached level ${hedgeTrade.level} at ${price}`);
    
    if (hedgeTrade.level >= 1) {
      const prevLevelPrice = hedgeTrade.entry + direction * getGridSpacing(currentLevel) * currentLevel;
      const currLevelPrice = hedgeTrade.entry + direction * getGridSpacing(hedgeTrade.level) * hedgeTrade.level;
      hedgeTrade.stopLoss = toPrecision(prevLevelPrice + config.gridStopLossPercent * (currLevelPrice - prevLevelPrice));
      sendMessage(`🔒 Hedge trade stop loss updated to ${hedgeTrade.stopLoss}`);
    }
  }

  if (hedgeTrade.level >= 1 && hedgeTrade.stopLoss !== null) {
    if ((hedgeTrade.side === 'Buy' && price <= hedgeTrade.stopLoss) ||
        (hedgeTrade.side === 'Sell' && price >= hedgeTrade.stopLoss)) {
      await closeHedgeTrade(price);
      return;
    }
  }
}

async function initializeBoundaries() {
  const price = getCurrentPrice();
  if (!price) {
    sendMessage('⚠️ Unable to get current price to set boundaries.');
    return;
  }

  const mainTrade = state.getMainTrade();
  if (mainTrade) {
    const spacing = config.tradeEntrySpacing;
    if (mainTrade.side === 'Buy') {
      boundaries.bottom = toPrecision(price - spacing);
      boundaries.top = null;
      sendMessage(`🔵 Buy main trade - bottom boundary set at ${boundaries.bottom} (current: ${price})`);
    } else if (mainTrade.side === 'Sell') {
      boundaries.top = toPrecision(price + spacing);
      boundaries.bottom = null;
      sendMessage(`🔴 Sell main trade - top boundary set at ${boundaries.top} (current: ${price})`);
    }
  } else {
    boundaries.top = toPrecision(price + config.tradeEntrySpacing);
    boundaries.bottom = toPrecision(price - config.tradeEntrySpacing);
    sendMessage(`⚪ No main trade - boundaries set at ${boundaries.bottom}-${boundaries.top} (current: ${price})`);
  }

  saveBoundary({ trailingBoundary, boundaries });
}

async function initializeFreshBoundaries() {
  boundaryLocked = true;   
  const price = getCurrentPrice();
  if (!price) {
    sendMessage('⚠️ Price unavailable - boundary reset delayed');
    return;
  } 
  await checkForNewTradeOpportunity(price);
}

async function checkForNewTradeOpportunity(price) {
  if (state.getMainTrade() || state.getHedgeTrade() || Date.now() < hedgeCooldownUntil) 
    return;

  const signal =  await analyze();

  if (signal === 'BUY') {
    await openMainTrade("Buy", price);
  } else if (signal === 'SELL') {
    await openMainTrade("Sell", price);
  }
}

async function initializeNewHedgeBoundaries() {
  const price = getCurrentPrice();
  if (!price) {
    sendMessage('⚠️ Unable to get current price to set boundaries.');
    return;
  }

  const mainTrade = state.getMainTrade();
  if (mainTrade) {
    if (mainTrade.side === 'Buy') {
      boundaries.bottom = toPrecision(price - config.newBoundarySpacing);
      boundaries.top = null;
      sendMessage(`🔵 For buy main trade - New hedge bottom boundary set at ${boundaries.bottom} (current: ${price})`);
    } else {
      boundaries.top = toPrecision(price + config.newBoundarySpacing);
      boundaries.bottom = null;
      sendMessage(`🔴 For sell main trade - New hedge top boundary set at ${boundaries.top} (current: ${price})`);
    }
  } else {
    sendMessage(`⚪ No main trade - boundaries set at ${boundaries.bottom}-${boundaries.top} (current: ${price})`);
  }

  saveBoundary({ trailingBoundary, boundaries });
}

async function constantHedgeTrailingBoundary(price, force = false, mainTradeArg = null) {
  const mainTrade = state.getMainTrade();
  let constantDistance = maintainedDistance;
  if (!mainTrade) return;

  let proposedBoundary;
  if (mainTrade.side === 'Buy') {
    proposedBoundary = toPrecision(price - constantDistance, config.pricePrecision);
    if (boundaries.bottom === null || proposedBoundary > boundaries.bottom) {
      boundaries.bottom = proposedBoundary;
      boundaries.top = null;
    } else {
      return;
    }
  } else if (mainTrade.side === 'Sell') {
    proposedBoundary = toPrecision(price + constantDistance, config.pricePrecision);
    if (boundaries.top === null || proposedBoundary < boundaries.top) {
      boundaries.top = proposedBoundary;
      boundaries.bottom = null;
    } else {
      return;
    }
  }

  await saveBoundary({ trailingBoundary, boundaries });
  sendMessage(
    `🔄 Boundary trailed towards price\n` +
    `🟦 Main Trade: ${mainTrade.side}\n` +
    `📈 Current price: ${toPrecision(price, config.pricePrecision)}\n` +
    `🎯 New boundary: ${mainTrade.side === 'Buy' ? boundaries.bottom : boundaries.top}\n` +
    `🚨 Maintained distance: ${constantDistance} points`
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function manualCloseMainTrade() {
  const price = getCurrentPrice();
  if (!price || !state.getMainTrade()) return;
  await closeMainTrade(price, true);
}

async function manualCloseHedgeTrade() {
  const price = getCurrentPrice();
  if (!price || !state.getHedgeTrade()) return;
  await closeHedgeTrade(price, true);
}

async function manualSellMainTrade() {
  if (state.isRunning()) return;
  try {
    await fetchPrecision(config);
    startPolling(1000);
    await waitForFirstPrice();
    state.startBot();
    sendMessage('🤖 Bot started');
    let price;
    while (true) {
      price = await getCurrentPrice();
      if (typeof price === 'number' && !isNaN(price)) break;
      sendMessage('⏳ Waiting for valid price to place Sell trade...');
      await delay(1000);
    }
    if (!state.getMainTrade() && !state.getHedgeTrade()) {
      await openMainTrade('Sell', price);
      await monitorPrice();
    } else {
      sendMessage('⚠️ Trade not placed: Main or Hedge already active.');
    }
  } catch (err) {
    sendMessage(`❌ manualSellMainTrade error: ${err.message}`);
  }
}

async function manualBuyMainTrade() {
  if (state.isRunning()) return;
  try {
    await fetchPrecision(config);
    startPolling(1000);
    await waitForFirstPrice();
    state.startBot();
    sendMessage('🤖 Bot started');
    let price;
    while (true) {
      price = await getCurrentPrice();
      if (typeof price === 'number' && !isNaN(price)) break;
      sendMessage('⏳ Waiting for valid price to place Buy trade...');
      await delay(1000);
    }
    if (!state.getMainTrade() && !state.getHedgeTrade()) {
      await openMainTrade('Buy', price);
      await monitorPrice();
    } else {
      sendMessage('⚠️ Trade not placed: Main or Hedge already active.');
    }
  } catch (err) {
    sendMessage(`❌ Error in manualBuyMainTrade: ${err.message}`);
  }
}

function stopBot() {
  stopPolling();
  state.stopBot();
  sendMessage('🛑 Bot stopped');
}

async function resetBot() {
  state.clearMainTrade();
  state.clearHedgeTrade();
  state.stopBot();
  state.saveState();
  clearBoundary();
  sendMessage('♻️ Persistent state cleared.');
  await initializeBoundaries();
  try {
    await bitgetClient.cancelAllOrders();
  } catch (e) {
    console.error('❌ Error canceling orders during reset:', e.message);
  }
}

module.exports = {
  startBot,
  stopBot,
  setSendMessage,
  openMainTrade,
  closeMainTrade,
  openHedgeTrade,
  closeHedgeTrade,
  manualCloseMainTrade,
  manualCloseHedgeTrade,
  manualBuyMainTrade,
  manualSellMainTrade,
  promoteHedgeToMain,
  resetBot,
};
