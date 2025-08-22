const priceFeed = require('./priceFeed');
priceFeed.startPolling(2000);

priceFeed.onPrice(p => {
  console.log("Current Price:", p);
});
