import { api, $, esc, money, fmtDateTime, fmtTime, renderHeader, requireRole, showError, toast, pinTiles } from './common.js';

await requireRole('customer');
renderHeader('orders');

const list = $('#orders');
const msg = $('#msg');
const LABELS = { reserved: 'Awaiting pickup', picked_up: 'Picked up', cancelled: 'Cancelled', expired: 'Not picked up', pending_payment: 'Processing' };

async function load() {
  try {
    const { orders } = await api('/orders');
    render(orders);
  } catch (err) {
    showError(msg, err);
  }
}

function render(orders) {
  if (!orders.length) {
    list.innerHTML = `<div class="empty"><img src="/assets/logo-mark.svg" alt=""><h3>No orders yet</h3><p>Grab a deal and your pickup PIN will show up here.</p>
      <a class="btn btn-primary" href="/offers">Browse deals</a></div>`;
    return;
  }
  list.innerHTML = orders.map((o) => {
    const r = o.restaurant;
    const charged = o.status === 'picked_up'
      ? `Charged ${money(o.totalCents)} to ${esc(o.cardLabel)}`
      : o.status === 'reserved' ? `Hold of ${money(o.totalCents)} on ${esc(o.cardLabel)}. Charged at pickup.`
      : 'Hold released. You were not charged.';
    return `
    <div class="card">
      <div class="order-item">
        <div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:16px">
        ${o.imageUrl ? `<img class="thumb" src="${esc(o.imageUrl)}" alt="">` : ''}
        <div>
          <span class="status ${o.status}">${LABELS[o.status] || esc(o.status)}</span>
          <h3 style="margin:8px 0 2px">${o.quantity} × ${esc(o.itemTitle)}</h3>
          <div class="muted small">${esc(r.name)} · ${esc(r.address)}, ${esc(r.city)} · Ordered ${fmtDateTime(o.createdAt)}</div>
          ${o.status === 'reserved' ? `<div class="small" style="margin-top:6px">🕒 Pick up by <b>${fmtTime(o.pickupEnd)}</b></div>` : ''}
          <div class="small" style="margin-top:8px">${o.quantity} × <span class="was">${money(o.originalUnitPriceCents)}</span> <b>${money(o.unitPriceCents)}</b>
            <span class="chip diet" style="margin-left:4px">-${o.discountPct}%</span> · Total <b>${money(o.totalCents)}</b></div>
          <div class="row" style="margin-top:10px;gap:8px">
            <a class="btn btn-ghost btn-sm" href="/receipt?order=${o.id}">🧾 View receipt</a>
            <a class="btn btn-ghost btn-sm" href="/api/orders/${o.id}/receipt.pdf">⬇ Download PDF</a>
          </div>
          <div class="small muted" style="margin-top:6px">${charged}</div>
        </div>
        </div>
        ${o.status === 'reserved' ? `
        <div class="pin-box" style="min-width:200px">
          <div class="small muted">Pickup PIN</div>
          ${pinTiles(o.pin, 'sm')}
          <button class="btn btn-danger btn-sm" data-cancel="${o.id}" style="margin-top:10px">Cancel order</button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

list.addEventListener('click', async (e) => {
  const id = e.target.closest('[data-cancel]')?.dataset.cancel;
  if (!id || !confirm('Cancel this order? The hold on your card will be released.')) return;
  try {
    await api(`/orders/${id}/cancel`, { method: 'POST' });
    toast('Order cancelled. You were not charged.');
    load();
  } catch (err) {
    showError(msg, err);
  }
});

load();
setInterval(load, 30000);
