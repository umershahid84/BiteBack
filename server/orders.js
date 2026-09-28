// Order lifecycle: pending_payment -> reserved -> picked_up
//                                  \-> failed    \-> cancelled | expired
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { transaction } = require('./db');
const { quote } = require('./pricing');
const { HttpError, bad } = require('./errors');

const MAX_PER_ORDER = 10;

function createOrderService({ db, config, payments }) {
  const nowIso = () => new Date().toISOString();
  // Emits 'reserved' (order) when a customer's payment hold succeeds, so restaurants can be alerted live.
  const events = new EventEmitter();
  events.setMaxListeners(0);

  const getOffer = db.prepare(`
    SELECT o.*, r.name AS restaurant_name, r.tax_rate_bps
    FROM offers o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.id = ?`);
  const activePins = db.prepare(`SELECT pin FROM orders WHERE restaurant_id = ? AND status IN ('pending_payment', 'reserved')`);
  const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
  const setStatus = db.prepare('UPDATE orders SET status = ?, closed_at = ? WHERE id = ? AND status = ?');
  const restock = db.prepare(`UPDATE offers SET quantity_available = MIN(quantity_total, quantity_available + ?)
                              WHERE id = ? AND status != 'ended' AND pickup_end > ?`);

  function priceFor(offer, quantity) {
    return quote({
      originalUnitCents: offer.original_price_cents,
      discountPct: offer.discount_pct,
      quantity,
      serviceFeeBps: config.serviceFeeBps,
      taxRateBps: offer.tax_rate_bps,
      taxServiceFee: config.taxServiceFee,
    });
  }

  function assertOrderable(offer, quantity) {
    if (!offer || offer.status !== 'active' || offer.pickup_end <= nowIso()) throw new HttpError(404, 'This offer is no longer available.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_ORDER) throw bad(`Quantity must be between 1 and ${MAX_PER_ORDER}.`);
    if (quantity > offer.quantity_available) {
      throw new HttpError(409, offer.quantity_available ? `Only ${offer.quantity_available} left.` : 'Sold out.');
    }
  }

  function quoteOffer(offerId, quantity) {
    const offer = getOffer.get(offerId);
    assertOrderable(offer, quantity);
    return { offer, quote: priceFor(offer, quantity) };
  }

  function uniquePin(restaurantId) {
    const used = new Set(activePins.all(restaurantId).map((r) => r.pin));
    if (used.size > 5000) throw new HttpError(503, 'This restaurant has too many open orders right now.');
    for (;;) {
      const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      if (!used.has(pin)) return pin;
    }
  }

  // Step 1: reserve the food and create a pending order (synchronous, so no oversell).
  function reserve({ userId, offerId, quantity, cardLabel }) {
    return transaction(db, () => {
      const offer = getOffer.get(offerId);
      assertOrderable(offer, quantity);
      const q = priceFor(offer, quantity);
      db.prepare('UPDATE offers SET quantity_available = quantity_available - ? WHERE id = ?').run(quantity, offer.id);
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO orders (user_id, offer_id, restaurant_id, item_title, quantity, unit_price_cents, original_unit_price_cents,
          discount_pct, subtotal_cents, service_fee_cents, tax_rate_bps, tax_cents, total_cents, pin, status, card_label, pickup_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`)
        .run(userId, offer.id, offer.restaurant_id, offer.title, quantity, q.unitPriceCents, q.originalUnitCents, q.discountPct,
          q.subtotalCents, q.serviceFeeCents, q.taxRateBps, q.taxCents, q.totalCents, uniquePin(offer.restaurant_id), cardLabel,
          offer.pickup_end);
      return { order: getOrder.get(lastInsertRowid), offer };
    });
  }

  function markReserved(orderId) {
    if (setStatus.run('reserved', null, orderId, 'pending_payment').changes) events.emit('reserved', getOrder.get(orderId));
  }

  // Step 2: place a hold on the card for the order total.
  async function authorize(order, { customerId, paymentRef, attached }) {
    let result;
    try {
      result = await payments.authorize({
        amountCents: order.total_cents,
        customerId,
        paymentRef,
        attached,
        description: `BiteBack order #${order.id}: ${order.quantity} x ${order.item_title}`,
        metadata: { order_id: String(order.id) },
      });
    } catch (err) {
      await release(order.id, 'pending_payment', 'failed', { restock: true });
      throw err;
    }
    db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(result.ref, order.id);
    if (result.status === 'authorized') markReserved(order.id);
    return result;
  }

  // Called after the browser completes 3-D Secure.
  async function confirmAuthorization(order) {
    if (order.status !== 'pending_payment' || !order.payment_ref) return getOrder.get(order.id);
    const status = await payments.authorizationStatus(order.payment_ref);
    if (status === 'authorized') markReserved(order.id);
    else if (status === 'failed') await release(order.id, 'pending_payment', 'failed', { restock: true });
    return getOrder.get(order.id);
  }

  // Moves an order from `from` to a closed status, voiding the card hold.
  async function release(orderId, from, to, { restock: doRestock = false } = {}) {
    const order = getOrder.get(orderId);
    const changed = transaction(db, () => {
      const { changes } = setStatus.run(to, nowIso(), orderId, from);
      if (changes && doRestock) restock.run(order.quantity, order.offer_id, nowIso());
      return changes > 0;
    });
    if (changed && order.payment_ref) await payments.void(order.payment_ref);
    return changed;
  }

  const capturing = new Set();

  // Restaurant confirms pickup with the customer's PIN: the card is charged now.
  async function completePickup(order) {
    if (order.status !== 'reserved') throw new HttpError(409, 'This order is not awaiting pickup.');
    if (capturing.has(order.id)) throw new HttpError(409, 'This order is already being processed.');
    capturing.add(order.id);
    try {
      await payments.capture(order.payment_ref);
      db.prepare(`UPDATE orders SET status = 'picked_up', picked_up_at = ?, closed_at = ? WHERE id = ? AND status = 'reserved'`)
        .run(nowIso(), nowIso(), order.id);
    } finally {
      capturing.delete(order.id);
    }
    return getOrder.get(order.id);
  }

  // Periodic cleanup of stale checkouts, missed pickups, and finished offers.
  async function sweep(now = new Date()) {
    const iso = now.toISOString();
    const stalePending = db.prepare(`SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < ?`)
      .all(new Date(now - config.pendingPaymentMinutes * 60000).toISOString());
    for (const { id } of stalePending) await release(id, 'pending_payment', 'failed', { restock: true });

    const missed = db.prepare(`SELECT id FROM orders WHERE status = 'reserved' AND pickup_end < ?`)
      .all(new Date(now - config.pickupGraceMinutes * 60000).toISOString());
    for (const { id } of missed) await release(id, 'reserved', 'expired');

    db.prepare(`UPDATE offers SET status = 'ended' WHERE status != 'ended' AND pickup_end < ?`).run(iso);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(iso);
    return { stalePending: stalePending.length, missed: missed.length };
  }

  return { events, quoteOffer, reserve, authorize, confirmAuthorization, release, completePickup, sweep, getOrder: (id) => getOrder.get(id) };
}

module.exports = { createOrderService, MAX_PER_ORDER };
