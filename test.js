const priceFeed = require('./priceFeed');

const { startPolling, onPrice, waitForFirstPrice } = require('./priceFeed');

startPolling(2000);

onPrice(price => {
  console.log("✅ Live price:", price);
});

(async () => {
  const firstPrice = await waitForFirstPrice();
  console.log("🎯 First price fetched:", firstPrice);
})();
