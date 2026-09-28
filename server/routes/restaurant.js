const express = require('express');
const v = require('../validate');
const { HttpError, bad } = require('../errors');
const { requireRole, createLimiter } = require('../auth');

module.exports = function restaurantRoutes({ db, orders }) {
  const router = express.Router();
  router.use(requireRole('restaurant'));

  // 4-digit PINs are guessable by brute force, so cap failed lookups per restaurant.
  const pinLimiter = createLimiter({ max: 15, windowMs: 10 * 60 * 1000 });

  router.use((req, _res, next) => {
    req.restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.user.id);
    if (!req.restaurant) return next(new HttpError(404, 'Restaurant profile not found.'));
    next();
  });

  // ---- Profile ----

  router.get('/profile', (req, res) => res.json({ restaurant: req.restaurant }));

  router.put('/profile', (req, res) => {
    const b = req.body || {};
    const r = {
      name: v.str(b.name, 'Restaurant name', { min: 2, max: 80 }),
      description: v.str(b.description, 'Description', { max: 400, optional: true }),
      cuisine: v.str(b.cuisine, 'Cuisine', { max: 40, optional: true }),
      address: v.str(b.address, 'Street address', { min: 3, max: 120 }),
      city: v.str(b.city, 'City', { min: 2, max: 60 }),
      zip: v.zip(b.zip),
      phone: v.str(b.phone, 'Phone', { max: 30, optional: true }),
      lat: v.coord(b.lat, 'Latitude', 90),
      lng: v.coord(b.lng, 'Longitude', 180),
      taxRateBps: Math.round(Number(b.taxRatePct) * 100),
    };
    if (!(r.taxRateBps >= 0 && r.taxRateBps <= 2000)) throw bad('Sales tax rate must be between 0% and 20%.');
    db.prepare(`UPDATE restaurants SET name = ?, description = ?, cuisine = ?, address = ?, city = ?, zip = ?, phone = ?,
                lat = ?, lng = ?, tax_rate_bps = ? WHERE id = ?`)
      .run(r.name, r.description, r.cuisine, r.address, r.city, r.zip, r.phone, r.lat, r.lng, r.taxRateBps, req.restaurant.id);
    res.json({ restaurant: db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurant.id) });
  });

  // ---- Offers ----

  function parseOffer(b, existing) {
    const pickupStart = v.isoDate(b.pickupStart, 'Pickup start');
    const pickupEnd = v.isoDate(b.pickupEnd, 'Pickup end');
    if (pickupEnd <= pickupStart) throw bad('Pickup end must be after pickup start.');
    if (!existing && pickupEnd <= new Date()) throw bad('Pickup end must be in the future.');
    if (pickupEnd - Date.now() > 72 * 3600 * 1000) throw bad('Pickup must end within 3 days.');
    const reason = String(b.reason || '');
    if (!v.OFFER_REASONS[reason]) throw bad('Please choose why this food is available.');
    return {
      title: v.str(b.title, 'Item name', { min: 2, max: 80 }),
      description: v.str(b.description, 'Description', { max: 500, optional: true }),
      reason,
      dietary: v.dietary(b.dietary),
      originalPriceCents: v.dollarsToCents(b.originalPrice, 'Original price', { min: 0.5, max: 1000 }),
      discountPct: v.int(Number(b.discountPct), 'Discount', { min: 1, max: 90 }),
      quantityTotal: v.int(Number(b.quantity), 'Quantity', { min: 1, max: 500 }),
      pickupStart: pickupStart.toISOString(),
      pickupEnd: pickupEnd.toISOString(),
    };
  }

  function ownOffer(req) {
    const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND restaurant_id = ?').get(Number(req.params.id), req.restaurant.id);
    if (!offer) throw new HttpError(404, 'Offer not found.');
    return offer;
  }

  const offerStats = `
    (SELECT COUNT(*) FROM orders x WHERE x.offer_id = o.id AND x.status = 'reserved') AS awaiting_pickup,
    (SELECT COALESCE(SUM(quantity), 0) FROM orders x WHERE x.offer_id = o.id AND x.status = 'picked_up') AS picked_up`;

  router.get('/offers', (req, res) => {
    const offers = db.prepare(`SELECT o.*, ${offerStats} FROM offers o WHERE o.restaurant_id = ?
                               ORDER BY CASE o.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, o.pickup_end DESC LIMIT 200`)
      .all(req.restaurant.id);
    res.json({ offers });
  });

  router.post('/offers', (req, res) => {
    const o = parseOffer(req.body || {});
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO offers (restaurant_id, title, description, reason, dietary, original_price_cents, discount_pct,
                          quantity_total, quantity_available, pickup_start, pickup_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.restaurant.id, o.title, o.description, o.reason, o.dietary, o.originalPriceCents, o.discountPct,
        o.quantityTotal, o.quantityTotal, o.pickupStart, o.pickupEnd);
    res.status(201).json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(lastInsertRowid) });
  });

  router.put('/offers/:id', (req, res) => {
    const existing = ownOffer(req);
    if (existing.status === 'ended') throw new HttpError(409, 'Ended offers cannot be edited.');
    const o = parseOffer(req.body || {}, existing);
    // Price changes only affect new orders; existing orders keep the price they were quoted.
    const committed = existing.quantity_total - existing.quantity_available;
    if (o.quantityTotal < committed) throw bad(`${committed} already ordered, so quantity cannot be lower than that.`);
    db.prepare(`UPDATE offers SET title = ?, description = ?, reason = ?, dietary = ?, original_price_cents = ?, discount_pct = ?,
                quantity_total = ?, quantity_available = ?, pickup_start = ?, pickup_end = ? WHERE id = ?`)
      .run(o.title, o.description, o.reason, o.dietary, o.originalPriceCents, o.discountPct, o.quantityTotal,
        o.quantityTotal - committed, o.pickupStart, o.pickupEnd, existing.id);
    db.prepare(`UPDATE orders SET pickup_end = ? WHERE offer_id = ? AND status IN ('pending_payment', 'reserved')`).run(o.pickupEnd, existing.id);
    res.json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(existing.id) });
  });

  router.post('/offers/:id/status', (req, res) => {
    const existing = ownOffer(req);
    const status = req.body?.status;
    if (!['active', 'paused', 'ended'].includes(status)) throw bad('Invalid status.');
    if (existing.status === 'ended') throw new HttpError(409, 'This offer has already ended.');
    if (status === 'active' && existing.pickup_end <= new Date().toISOString()) throw bad('The pickup window has passed. Create a new offer.');
    db.prepare('UPDATE offers SET status = ? WHERE id = ?').run(status, existing.id);
    res.json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(existing.id) });
  });

  // ---- Orders & pickup ----

  function presentOrder(o, { withPin = false } = {}) {
    const customer = db.prepare('SELECT username FROM users WHERE id = ?').get(o.user_id);
    return {
      id: o.id,
      status: o.status,
      itemTitle: o.item_title,
      quantity: o.quantity,
      unitPriceCents: o.unit_price_cents,
      subtotalCents: o.subtotal_cents,
      serviceFeeCents: o.service_fee_cents,
      taxCents: o.tax_cents,
      totalCents: o.total_cents,
      customerUsername: customer?.username,
      pickupEnd: o.pickup_end,
      createdAt: o.created_at,
      pickedUpAt: o.picked_up_at,
      pin: withPin ? o.pin : undefined,
    };
  }

  router.get('/orders', (req, res) => {
    const status = String(req.query.status || '');
    const rows = status
      ? db.prepare('SELECT * FROM orders WHERE restaurant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200').all(req.restaurant.id, status)
      : db.prepare(`SELECT * FROM orders WHERE restaurant_id = ? AND status NOT IN ('pending_payment', 'failed')
                    ORDER BY created_at DESC LIMIT 200`).all(req.restaurant.id);
    res.json({ orders: rows.map((o) => presentOrder(o)) });
  });

  function findByPin(req) {
    const key = String(req.restaurant.id);
    if (!pinLimiter.check(key)) throw new HttpError(429, 'Too many incorrect PINs. Please wait 10 minutes.');
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{4}$/.test(pin)) throw bad('Enter the 4-digit PIN.');
    const order = db.prepare(`SELECT * FROM orders WHERE restaurant_id = ? AND pin = ? AND status = 'reserved'`).get(req.restaurant.id, pin);
    if (!order) {
      pinLimiter.fail(key);
      throw new HttpError(404, 'No order awaiting pickup matches that PIN.');
    }
    return order;
  }

  router.post('/pickup/lookup', (req, res) => {
    res.json({ order: presentOrder(findByPin(req)) });
  });

  router.post('/pickup/confirm', async (req, res) => {
    const order = findByPin(req);
    if (req.body?.orderId && Number(req.body.orderId) !== order.id) throw new HttpError(409, 'PIN does not match this order.');
    const done = await orders.completePickup(order);
    res.json({ order: presentOrder(done) });
  });

  router.get('/stats', (req, res) => {
    const id = req.restaurant.id;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const agg = (where, ...args) => db.prepare(`
      SELECT COUNT(*) AS orders, COALESCE(SUM(quantity), 0) AS meals, COALESCE(SUM(subtotal_cents), 0) AS sales_cents,
             COALESCE(SUM((original_unit_price_cents - unit_price_cents) * quantity), 0) AS customer_savings_cents
      FROM orders WHERE restaurant_id = ? AND ${where}`).get(id, ...args);
    res.json({
      today: agg(`status = 'picked_up' AND picked_up_at >= ?`, since.toISOString()),
      allTime: agg(`status = 'picked_up'`),
      awaitingPickup: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ? AND status = 'reserved'`).get(id).n,
      activeOffers: db.prepare(`SELECT COUNT(*) AS n FROM offers WHERE restaurant_id = ? AND status = 'active'`).get(id).n,
    });
  });

  return router;
};
