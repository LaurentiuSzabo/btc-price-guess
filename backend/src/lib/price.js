const PRICE_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

async function getBtcPrice() {
  const res = await fetch(PRICE_URL);
  if (!res.ok) {
    throw new Error(`Price API returned ${res.status}`);
  }
  const body = await res.json();
  const amount = Number(body?.data?.amount);
  if (!Number.isFinite(amount)) {
    throw new Error('Price API returned an unexpected payload');
  }
  return amount;
}

module.exports = { getBtcPrice };
