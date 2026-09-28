import { api, $, esc, money, pct, fmtWindow, fmtTime, renderHeader, requireRole, showError, openModal, withBusy, cuisineEmoji } from './common.js';
import { createCardEntry, cardText, getConfig } from './cards.js';

await requireRole('customer');
renderHeader('offers');

const grid = $('#offers');
const msg = $('#msg');
let origin = null;
try {
  origin = JSON.parse(sessionStorage.getItem('bb-origin') || 'null');
} catch { /* storage unavailable */ }

const config = await getConfig();
for (const tag of config.dietaryTags) $('#f-diet').insertAdjacentHTML('beforeend', `<option value="${esc(tag)}">${esc(tag[0].toUpperCase() + tag.slice(1))}</option>`);

let offers = [];
let debounce;

async function load() {
  const params = new URLSearchParams();
  const set = (k, v) => v && params.set(k, v);
  set('q', $('#f-q').value.trim());
  set('area', $('#f-area').value.trim());
  set('dietary', $('#f-diet').value);
  set('sort', $('#f-sort').value);
  if (origin) {
    set('lat', origin.lat);
    set('lng', origin.lng);
    set('radius', $('#f-radius').value);
  }
  try {
    ({ offers } = await api(`/offers?${params}`));
    showError(msg, null);
    render();
  } catch (err) {
    showError(msg, err);
  }
}

function render() {
  if (!offers.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><img src="/assets/logo-mark.svg" alt=""><h3>No deals match right now</h3>
      <p>New surplus food is posted throughout the day. Check back soon or widen your search.</p></div>`;
    return;
  }
  grid.innerHTML = offers.map((o) => `
    <article class="offer">
      <div class="offer-top" aria-hidden="true">${cuisineEmoji(o.restaurant.cuisine)}
        <span class="badge-off">-${o.discountPct}%</span>
        <span class="badge-left">${o.quantityAvailable} left</span>
      </div>
      <div class="offer-body">
        <h3>${esc(o.title)}</h3>
        <div class="offer-rest">${esc(o.restaurant.name)} · ${esc(o.restaurant.city)}</div>
        <div class="offer-meta">
          <span>🕒 ${fmtWindow(o.pickupStart, o.pickupEnd)}</span>
          ${o.distanceMiles != null ? `<span>📍 ${o.distanceMiles} mi</span>` : ''}
        </div>
        <div class="chips"><span class="chip reason">${esc(o.reasonLabel)}</span>${o.dietary.map((d) => `<span class="chip diet">${esc(d)}</span>`).join('')}</div>
        <div class="price-row"><span class="price">${money(o.priceCents)}</span><span class="was">${money(o.originalPriceCents)}</span>
          <span class="spacer"></span><button class="btn btn-primary btn-sm" data-id="${o.id}">Order</button></div>
      </div>
    </article>`).join('');
}

grid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) openCheckout(offers.find((o) => o.id === Number(btn.dataset.id)));
});

$('#filters').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 250);
});
$('#filters').addEventListener('submit', (e) => e.preventDefault());

$('#locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return showError(msg, 'Location is not available in this browser.');
  $('#locate-btn').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude.toFixed(4), lng: pos.coords.longitude.toFixed(4) };
      try { sessionStorage.setItem('bb-origin', JSON.stringify(origin)); } catch { /* ignore */ }
      $('#locate-btn').textContent = '📍 Location on';
      load();
    },
    () => {
      $('#locate-btn').textContent = '📍 Use my location';
      showError(msg, 'We could not get your location. You can search by city or ZIP instead.');
    },
    { timeout: 10000, maximumAge: 600000 },
  );
});
if (origin) $('#locate-btn').textContent = '📍 Location on';

// ---------- Checkout ----------

async function openCheckout(offer) {
  const r = offer.restaurant;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${r.address}, ${r.city}, WA ${r.zip}`)}`;
  const modal = openModal(offer.title, `
    <p style="margin:0 0 6px"><b>${esc(r.name)}</b>${r.cuisine ? ` · ${esc(r.cuisine)}` : ''}</p>
    <p class="small muted" style="margin:0 0 10px">${esc(r.address)}, ${esc(r.city)}, WA ${esc(r.zip)} · <a href="${mapUrl}" target="_blank" rel="noopener">Map</a>
      ${r.phone ? ` · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}</p>
    ${offer.description ? `<p>${esc(offer.description)}</p>` : ''}
    <div class="chips" style="margin-bottom:10px"><span class="chip reason">Why it's discounted: ${esc(offer.reasonLabel)}</span>
      ${offer.dietary.map((d) => `<span class="chip diet">${esc(d)}</span>`).join('')}</div>
    <div class="alert alert-warn small">🕒 Pick up <b>${fmtWindow(offer.pickupStart, offer.pickupEnd)}</b>. Orders not picked up by then are released and not charged.</div>

    <div class="row"><span class="section-label" style="margin:0">Quantity</span><span class="spacer"></span>
      <div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><span id="qty">1</span><button type="button" data-q="1" aria-label="More">+</button></div></div>

    <div class="section-label">Order summary</div>
    <table class="breakdown" id="breakdown"></table>

    <div class="section-label">Payment</div>
    <div id="pay-options"></div>
    <div id="new-card" class="card-entry hidden">
      <div id="card-mount"></div>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="save-card" checked> Save this card for future orders</label>
    </div>
    <p class="small muted" style="margin:12px 0">🔒 We'll place a temporary hold for the total now. <b>Your card is charged only when you pick up</b> and the restaurant enters your PIN.</p>
    <div id="co-msg"></div>
    <button class="btn btn-primary btn-block" id="place-btn">Place order</button>`);

  const body = modal.body;
  let quantity = 1;
  const max = Math.min(offer.quantityAvailable, 10);

  async function refreshQuote() {
    $('#qty', body).textContent = quantity;
    try {
      const { quote: q } = await api('/quote', { method: 'POST', body: { offerId: offer.id, quantity } });
      $('#breakdown', body).innerHTML = `
        <tr><td>${q.quantity} × ${esc(offer.title)} <span class="was small">${money(q.originalUnitCents)}</span> ${money(q.unitPriceCents)}</td><td>${money(q.subtotalCents)}</td></tr>
        <tr><td colspan="2" class="save">You save ${money(q.savingsCents)} (${q.discountPct}% off)</td></tr>
        <tr><td>Service fee (${pct(q.serviceFeeBps)})</td><td>${money(q.serviceFeeCents)}</td></tr>
        <tr><td>WA sales tax (${pct(q.taxRateBps)})</td><td>${money(q.taxCents)}</td></tr>
        <tr class="total"><td>Total</td><td>${money(q.totalCents)}</td></tr>`;
      $('#place-btn', body).textContent = `Place order · ${money(q.totalCents)}`;
      showError($('#co-msg', body), null);
    } catch (err) {
      showError($('#co-msg', body), err);
    }
  }

  body.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    quantity = Math.max(1, Math.min(max, quantity + Number(b.dataset.q)));
    refreshQuote();
  }));

  // Payment options: saved cards + new card.
  const { cards } = await api('/cards');
  $('#pay-options', body).innerHTML = cards.map((c, i) => `
      <label class="pay-option"><input type="radio" name="pay" value="${c.id}" ${i === 0 ? 'checked' : ''}> 💳 ${cardText(c)}
        <span class="muted small">exp ${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}</span></label>`).join('') +
    `<label class="pay-option"><input type="radio" name="pay" value="new" ${cards.length ? '' : 'checked'}> ➕ Use a new card</label>`;
  const cardEntry = await createCardEntry($('#card-mount', body));
  const syncPay = () => $('#new-card', body).classList.toggle('hidden', body.querySelector('input[name=pay]:checked').value !== 'new');
  body.querySelectorAll('input[name=pay]').forEach((i) => i.addEventListener('change', syncPay));
  syncPay();
  refreshQuote();

  $('#place-btn', body).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const coMsg = $('#co-msg', body);
    try {
      const choice = body.querySelector('input[name=pay]:checked').value;
      const payload = { offerId: offer.id, quantity };
      if (choice === 'new') payload.newCard = { token: await cardEntry.getToken(), save: $('#save-card', body).checked };
      else payload.cardId = Number(choice);

      let { order, requiresAction, clientSecret } = await api('/orders', { method: 'POST', body: payload });
      if (requiresAction) {
        await cardEntry.handleAction(clientSecret);
        ({ order } = await api(`/orders/${order.id}/confirm-payment`, { method: 'POST' }));
      }
      showConfirmation(modal, order);
      load();
    } catch (err) {
      showError(coMsg, err);
      if (err.status === 404 || err.status === 409) load();
    }
  }));
}

function showConfirmation(modal, order) {
  const r = order.restaurant;
  modal.el.querySelector('.modal-head h2').textContent = 'Order reserved!';
  modal.body.innerHTML = `
    <div class="pin-box">
      <div class="small muted">Show this PIN at pickup</div>
      <div class="pin" aria-label="PIN ${order.pin.split('').join(' ')}">${esc(order.pin)}</div>
    </div>
    <p style="margin-top:16px"><b>${order.quantity} × ${esc(order.itemTitle)}</b><br>
      <span class="muted">${esc(r.name)} · ${esc(r.address)}, ${esc(r.city)}</span></p>
    <p>Pick up by <b>${fmtTime(order.pickupEnd)}</b>. When the restaurant enters your PIN, your ${esc(order.cardLabel)} will be charged <b>${money(order.totalCents)}</b>.</p>
    <div class="row"><a class="btn btn-green" href="/orders">View my orders</a><button class="btn btn-ghost" id="keep-browsing">Keep browsing</button></div>`;
  $('#keep-browsing', modal.body).addEventListener('click', modal.close);
}

load();
