const test = require('node:test');
const assert = require('node:assert/strict');
const { quote, discountedUnitPrice } = require('../server/pricing');

test('discounted unit price rounds to the nearest cent', () => {
  assert.equal(discountedUnitPrice(1695, 50), 848); // 847.5 -> 848
  assert.equal(discountedUnitPrice(1000, 35), 650);
});

test('quote includes 5% service fee and WA sales tax on food', () => {
  const q = quote({ originalUnitCents: 2000, discountPct: 50, quantity: 2, serviceFeeBps: 500, taxRateBps: 1035 });
  assert.equal(q.unitPriceCents, 1000);
  assert.equal(q.subtotalCents, 2000);
  assert.equal(q.savingsCents, 2000);
  assert.equal(q.serviceFeeCents, 100);
  assert.equal(q.taxCents, 207);
  assert.equal(q.totalCents, 2307);
});

test('service fee can be made taxable', () => {
  const q = quote({ originalUnitCents: 2000, discountPct: 50, quantity: 2, serviceFeeBps: 500, taxRateBps: 1035, taxServiceFee: true });
  assert.equal(q.taxCents, 217); // 10.35% of $21.00 = 217.35
  assert.equal(q.totalCents, 2317);
});
