const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { createPaymentProvider } = require('../server/payments');

const config = {
  serviceFeeBps: 500, defaultTaxRateBps: 1035, taxServiceFee: false, stripeSecretKey: '', cookieSecure: false,
  sessionDays: 1, pendingPaymentMinutes: 15, pickupGraceMinutes: 30,
};

async function setup() {
  const db = openDatabase(':memory:');
  const payments = createPaymentProvider(config);
  const captured = [];
  const voided = [];
  const capture = payments.capture.bind(payments);
  const voidFn = payments.void.bind(payments);
  payments.capture = (ref) => { captured.push(ref); return capture(ref); };
  payments.void = (ref) => { voided.push(ref); return voidFn(ref); };
  const { app, orders } = createApp({ db, config, payments });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  function client() {
    let cookie = '';
    return async (path, { method = 'GET', body, csrf = true } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', cookie, ...(csrf ? { 'x-requested-with': 'BiteBack' } : {}) },
        body: body && JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  }
  return { db, orders, server, client, captured, voided };
}

const card = (last4 = '4242') => ({ brand: 'visa', last4, expMonth: 12, expYear: new Date().getFullYear() + 2 });

test('full flow: sign up, post offer, order, verify PIN, charge at pickup', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());

  const shop = env.client();
  let r = await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'owner@example.com', username: 'thai_place', password: 'secret123',
    restaurant: { name: 'Thai Place', address: '1 Pine St', city: 'Seattle', zip: '98101' },
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const start = new Date(Date.now() - 60000).toISOString();
  const end = new Date(Date.now() + 3 * 3600000).toISOString();
  r = await shop('/restaurant/offers', { method: 'POST', body: {
    title: 'Pad Thai', reason: 'wrong_order', originalPrice: '20.00', discountPct: 50, quantity: 3,
    pickupStart: start, pickupEnd: end, dietary: ['spicy'],
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const offerId = r.body.offer.id;

  const alice = env.client();
  r = await alice('/offers');
  assert.equal(r.status, 401, 'offers require an account');
  r = await alice('/auth/signup', { method: 'POST', body: { email: 'alice@example.com', username: 'alice', password: 'hunter22x' } });
  assert.equal(r.status, 201);

  r = await alice('/auth/signup', { method: 'POST', body: { email: 'ALICE@example.com', username: 'alice2', password: 'hunter22x' } });
  assert.equal(r.status, 409, 'duplicate email rejected');

  r = await alice('/offers');
  assert.equal(r.body.offers.length, 1);
  assert.equal(r.body.offers[0].priceCents, 1000);

  r = await alice('/quote', { method: 'POST', body: { offerId, quantity: 2 } });
  assert.deepEqual(
    [r.body.quote.subtotalCents, r.body.quote.serviceFeeCents, r.body.quote.taxCents, r.body.quote.totalCents],
    [2000, 100, 207, 2307],
  );

  // Order with a new card and save it.
  r = await alice('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card(), save: true } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = r.body.order;
  assert.equal(order.status, 'reserved');
  assert.match(order.pin, /^\d{4}$/);
  assert.equal(order.totalCents, 2307);
  assert.equal(env.captured.length, 0, 'not charged at order time');

  r = await alice('/cards');
  assert.equal(r.body.cards.length, 1);
  assert.equal(r.body.cards[0].is_default, 1);

  r = await alice('/offers');
  assert.equal(r.body.offers[0].quantityAvailable, 1);

  // Cannot oversell.
  r = await alice('/orders', { method: 'POST', body: { offerId, quantity: 2, cardId: 1 } });
  assert.equal(r.status, 409);

  // Restaurant verifies PIN; wrong PIN first.
  const wrong = order.pin === '0000' ? '0001' : '0000';
  r = await shop('/restaurant/pickup/lookup', { method: 'POST', body: { pin: wrong } });
  assert.equal(r.status, 404);
  r = await shop('/restaurant/pickup/lookup', { method: 'POST', body: { pin: order.pin } });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.customerUsername, 'alice');

  r = await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin, orderId: order.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.status, 'picked_up');
  assert.equal(env.captured.length, 1, 'charged at pickup');

  // PIN cannot be reused.
  r = await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin } });
  assert.equal(r.status, 404);

  r = await alice('/orders');
  assert.equal(r.body.orders[0].status, 'picked_up');
  assert.equal(r.body.orders[0].pin, null, 'PIN hidden after pickup');

  r = await shop('/restaurant/stats');
  assert.equal(r.body.allTime.meals, 2);
  assert.equal(r.body.allTime.sales_cents, 2000);
});

test('declined card releases the reserved food', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Bellevue', zip: '98004' },
  } });
  const { body } = await shop('/restaurant/offers', { method: 'POST', body: {
    title: 'Curry', reason: 'overproduction', originalPrice: 10, discountPct: 40, quantity: 1,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });

  const bob = env.client();
  await bob('/auth/signup', { method: 'POST', body: { email: 'bob@example.com', username: 'bob', password: 'password1' } });
  let r = await bob('/orders', { method: 'POST', body: { offerId: body.offer.id, quantity: 1, newCard: { token: card('0002') } } });
  assert.equal(r.status, 402);
  r = await bob('/offers');
  assert.equal(r.body.offers[0].quantityAvailable, 1);
  r = await bob('/orders');
  assert.equal(r.body.orders.length, 0);
});

test('cancel releases hold; missed pickups expire without charge', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Redmond', zip: '98052' },
  } });
  const { body } = await shop('/restaurant/offers', { method: 'POST', body: {
    title: 'Poke', reason: 'end_of_day', originalPrice: 16, discountPct: 45, quantity: 5,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });
  const offerId = body.offer.id;

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'c@example.com', username: 'carol', password: 'password1' } });
  await c('/cards', { method: 'POST', body: { token: card() } });
  let r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, cardId: 1 } });
  const first = r.body.order;
  r = await c(`/orders/${first.id}/cancel`, { method: 'POST' });
  assert.equal(r.body.order.status, 'cancelled');
  assert.equal(env.voided.length, 1);
  r = await c('/offers');
  assert.equal(r.body.offers[0].quantityAvailable, 5, 'cancelled quantity restocked');

  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 1, cardId: 1 } });
  const second = r.body.order;
  await env.orders.sweep(new Date(Date.now() + 2 * 3600000));
  r = await c(`/orders/${second.id}`);
  assert.equal(r.body.order.status, 'expired');
  assert.equal(env.voided.length, 2);
  assert.equal(env.captured.length, 0);
});

test('security: CSRF header required, roles enforced, PIN brute force limited', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const c = env.client();
  let r = await c('/auth/signup', { method: 'POST', csrf: false, body: { email: 'x@example.com', username: 'xx_x', password: 'password1' } });
  assert.equal(r.status, 403);
  r = await c('/auth/signup', { method: 'POST', body: { email: 'x@example.com', username: 'xx_x', password: 'password1' } });
  assert.equal(r.status, 201);
  r = await c('/restaurant/offers');
  assert.equal(r.status, 403);

  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Kirkland', zip: '98033' },
  } });
  r = await shop('/offers');
  assert.equal(r.status, 403);
  let last;
  for (let i = 0; i < 16; i++) last = await shop('/restaurant/pickup/lookup', { method: 'POST', body: { pin: String(i).padStart(4, '0') } });
  assert.equal(last.status, 429);
});
