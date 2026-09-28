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
  const uploadsDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'bb-uploads-'));
  const { app, orders } = createApp({ db, config: { ...config, uploadsDir }, payments });
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
  return { db, orders, server, client, captured, voided, base };
}

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function menuItem(shop, name, price, extra = {}) {
  const r = await shop('/restaurant/menu', { method: 'POST', body: { name, price, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.item.id;
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
  const padThai = await menuItem(shop, 'Pad Thai', '20.00', { dietary: ['spicy'], image: PNG });
  r = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: padThai, reason: 'wrong_order', discountPct: 50, quantity: 3, pickupStart: start, pickupEnd: end,
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
  assert.equal(r.body.offers[0].title, 'Pad Thai');
  assert.equal(r.body.offers[0].priceCents, 1000);
  assert.deepEqual(r.body.offers[0].dietary, ['spicy']);
  assert.match(r.body.offers[0].imageUrl, /^\/uploads\/[0-9a-f]+\.png$/);
  const photo = await fetch(env.base.replace('/api', '') + r.body.offers[0].imageUrl);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

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
  const curry = await menuItem(shop, 'Curry', 10);
  const { body } = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: curry, reason: 'overproduction', discountPct: 40, quantity: 1,
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
  const poke = await menuItem(shop, 'Poke', 16);
  const { body } = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: poke, reason: 'end_of_day', discountPct: 45, quantity: 5,
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

test('menu: offers must come from the restaurant\'s own menu; bad photos rejected', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const a = env.client();
  const b = env.client();
  for (const [c, u] of [[a, 'shop_a'], [b, 'shop_b']]) {
    await c('/auth/signup', { method: 'POST', body: {
      role: 'restaurant', email: `${u}@example.com`, username: u, password: 'secret123',
      restaurant: { name: u, address: '1 Main', city: 'Seattle', zip: '98101' },
    } });
  }
  let r = await a('/restaurant/menu', { method: 'POST', body: { name: 'Soup', price: 5, image: 'data:image/png;base64,SGVsbG8=' } });
  assert.equal(r.status, 400, 'non-image bytes rejected');
  const soup = await menuItem(a, 'Soup', 5);
  const times = { pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString() };
  r = await b('/restaurant/offers', { method: 'POST', body: { menuItemId: soup, reason: 'other', discountPct: 30, quantity: 1, ...times } });
  assert.equal(r.status, 404, 'cannot offer another restaurant\'s menu item');
  r = await a('/restaurant/offers', { method: 'POST', body: { reason: 'other', discountPct: 30, quantity: 1, ...times } });
  assert.equal(r.status, 404, 'menu item required');
  r = await a('/restaurant/menu');
  assert.equal(r.body.items.length, 1);
  r = await a(`/restaurant/menu/${soup}`, { method: 'DELETE' });
  assert.equal(r.body.items.length, 0);
});

test('restaurant gets a live event when an order is placed', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  let r = await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Seattle', zip: '98101' },
  } });
  const item = await menuItem(shop, 'Noodles', 12);
  r = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: item, reason: 'other', discountPct: 50, quantity: 2,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });
  const offerId = r.body.offer.id;

  // Open the event stream with the restaurant's session cookie.
  const login = await fetch(`${env.base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'BiteBack' },
    body: JSON.stringify({ login: 'shop', password: 'secret123' }),
  });
  const ctrl = new AbortController();
  const stream = await fetch(`${env.base}/restaurant/events`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] }, signal: ctrl.signal });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.getReader();
  const received = (async () => {
    let text = '';
    while (!text.includes('event: order')) text += new TextDecoder().decode((await reader.read()).value);
    return text;
  })();

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'c@example.com', username: 'carol', password: 'password1' } });
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card() } } });
  assert.equal(r.status, 201);
  const text = await received;
  const data = JSON.parse(text.split('event: order\ndata: ')[1].split('\n')[0]);
  assert.equal(data.itemTitle, 'Noodles');
  assert.equal(data.quantity, 2);
  assert.equal(data.pin, undefined, 'PIN is never sent to the restaurant');
  ctrl.abort();
});

test('receipt shows full order details; restaurant daily report as JSON, PDF and CSV', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Pho Place', address: '1 Pine St', city: 'Seattle', zip: '98101', phone: '(206) 555-0199' },
  } });
  const item = await menuItem(shop, 'Beef Pho', '16.00');
  let r = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: item, reason: 'wrong_order', discountPct: 50, quantity: 3,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });
  const offerId = r.body.offer.id;

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'dana@example.com', username: 'dana', password: 'password1' } });
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card() } } });
  const order = r.body.order;

  r = await c(`/orders/${order.id}/receipt`);
  const rc = r.body.receipt;
  assert.match(rc.receiptNumber, /^BB-\d{8}-\d{6}$/);
  assert.equal(rc.restaurant.name, 'Pho Place');
  assert.equal(rc.customer.email, 'dana@example.com');
  assert.equal(rc.item.title, 'Beef Pho');
  assert.equal(rc.item.originalUnitCents, 1600);
  assert.equal(rc.item.discountPct, 50);
  assert.equal(rc.item.unitPriceCents, 800);
  assert.equal(rc.item.savingsCents, 1600);
  assert.equal(rc.card, 'VISA •••• 4242');
  assert.match(rc.paymentRef, /^pi_/);
  assert.equal(rc.amountChargedCents, 0, 'not charged before pickup');
  assert.equal(rc.pin, order.pin);

  await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin } });
  r = await c(`/orders/${order.id}/receipt`);
  assert.equal(r.body.receipt.amountChargedCents, order.totalCents);
  assert.equal(r.body.receipt.pin, null);

  const base = env.base;
  const getRaw = async (client, path) => {
    // reuse the client's cookie by calling through it once, then fetch raw bytes
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'BiteBack' },
      body: JSON.stringify(client) });
    return fetch(base + path, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
  };
  let res = await getRaw({ login: 'dana', password: 'password1' }, `/orders/${order.id}/receipt.pdf`);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="BiteBack-receipt-BB-/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  res = await getRaw({ login: 'shop', password: 'secret123' }, `/orders/${order.id}/receipt.pdf`);
  assert.equal(res.status, 403, 'restaurants cannot open customer receipts');

  r = await shop('/restaurant/report');
  const rep = r.body.report;
  assert.equal(rep.summary.ordersPickedUp, 1);
  assert.equal(rep.summary.mealsRescued, 2);
  assert.equal(rep.summary.foodSalesCents, 1600);
  assert.equal(rep.summary.discountsCents, 1600);
  assert.equal(rep.orders[0].item, 'Beef Pho');

  res = await getRaw({ login: 'shop', password: 'secret123' }, `/restaurant/report.pdf?date=${rep.date}`);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  res = await getRaw({ login: 'shop', password: 'secret123' }, `/restaurant/report.csv?date=${rep.date}`);
  const csv = await res.text();
  assert.match(csv, /^Order #,Ordered,Picked up,Customer,Item/);
  assert.match(csv, /Beef Pho,2,16\.00,50,8\.00,16\.00/);

  r = await shop('/restaurant/report?date=2020-01-01');
  assert.equal(r.body.report.orders.length, 0);
  r = await shop('/restaurant/report?date=nope');
  assert.equal(r.status, 400);
});

test('dayRange handles Pacific time and DST', () => {
  const { dayRange } = require('../server/receipts');
  assert.deepEqual(dayRange('2026-01-15', 'America/Los_Angeles'), { start: '2026-01-15T08:00:00.000Z', end: '2026-01-16T08:00:00.000Z' });
  assert.deepEqual(dayRange('2026-07-04', 'America/Los_Angeles'), { start: '2026-07-04T07:00:00.000Z', end: '2026-07-05T07:00:00.000Z' });
  assert.deepEqual(dayRange('2026-03-08', 'America/Los_Angeles'), { start: '2026-03-08T08:00:00.000Z', end: '2026-03-09T07:00:00.000Z' });
});

test('quantity is limited only by what the restaurant made available; area search and auto map pins', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const signupShop = async (u, city, zip) => {
    const c = env.client();
    const r = await c('/auth/signup', { method: 'POST', body: {
      role: 'restaurant', email: `${u}@example.com`, username: u, password: 'secret123',
      restaurant: { name: u, address: '1 Main St', city, zip },
    } });
    assert.equal(r.status, 201);
    assert.ok(r.body.user.restaurant.lat, 'pinned from ZIP code');
    return c;
  };
  const tacoma = await signupShop('tacoma_shop', 'Tacoma', '98402');
  const oly = await signupShop('oly_shop', 'Olympia', '98501');
  const times = { pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString() };
  let r = await tacoma('/restaurant/offers', { method: 'POST', body: { menuItemId: await menuItem(tacoma, 'Tacos', 12), reason: 'other', discountPct: 50, quantity: 15, ...times } });
  const tacos = r.body.offer.id;
  await oly('/restaurant/offers', { method: 'POST', body: { menuItemId: await menuItem(oly, 'Pizza', 20), reason: 'other', discountPct: 50, quantity: 2, ...times } });

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'eve@example.com', username: 'eve', password: 'password1' } });

  r = await c('/offers?area=Tacoma');
  assert.equal(r.body.place.label, 'Tacoma, WA');
  assert.deepEqual(r.body.offers.map((o) => o.title), ['Tacos'], 'Olympia is outside 10 miles of Tacoma');
  r = await c('/offers?area=Tacoma&radius=50');
  assert.equal(r.body.offers.length, 2);
  r = await c('/offers?area=98501');
  assert.deepEqual(r.body.offers.map((o) => o.title), ['Pizza']);

  r = await c('/quote', { method: 'POST', body: { offerId: tacos, quantity: 16 } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Only 15 available/);
  r = await c('/orders', { method: 'POST', body: { offerId: tacos, quantity: 12, newCard: { token: card() } } });
  assert.equal(r.status, 201, 'more than 10 is fine when the restaurant has them');
  r = await c('/orders', { method: 'POST', body: { offerId: tacos, quantity: 4, newCard: { token: card() } } });
  assert.equal(r.status, 409, 'only 3 left');

  const areas = await (await fetch(`${env.base}/auth/areas`)).json();
  for (const city of ['Des Moines', 'Kent', 'Federal Way', 'Tacoma', 'Fife', 'Olympia']) {
    assert.ok(areas.cities.some((x) => x.name === city), city);
  }
});
