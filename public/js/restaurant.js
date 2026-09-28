import { api, $, $$, esc, money, pct, fmtWindow, fmtDateTime, renderHeader, requireRole, showError, openModal, withBusy, toast } from './common.js';
import { getConfig } from './cards.js';

await requireRole('restaurant');
renderHeader('dash');
const config = await getConfig();
let restaurant = (await api('/restaurant/profile')).restaurant;

function setTitle() {
  $('#r-title').textContent = restaurant.name;
  $('#r-sub').textContent = `${restaurant.address}, ${restaurant.city} ${restaurant.zip} · Sales tax ${pct(restaurant.tax_rate_bps)}`;
}
setTitle();

// ---------- Tabs ----------
const panels = { pickup: renderPickup, offers: renderOffers, orders: renderOrders, profile: renderProfile };
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  panels[name]($(`[data-panel="${name}"]`));
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

async function renderKpis() {
  const s = await api('/restaurant/stats');
  $('#kpis').innerHTML = `
    <div class="kpi"><b>${s.awaitingPickup}</b><span>Orders awaiting pickup</span></div>
    <div class="kpi"><b>${s.activeOffers}</b><span>Active offers</span></div>
    <div class="kpi"><b>${s.today.meals}</b><span>Meals rescued today · ${money(s.today.sales_cents)}</span></div>
    <div class="kpi"><b>${s.allTime.meals}</b><span>Meals rescued all-time · ${money(s.allTime.sales_cents)}</span></div>`;
}

// ---------- Pickup verification ----------
function renderPickup(panel) {
  panel.innerHTML = `
    <div class="card" style="max-width:520px;margin:0 auto">
      <h2 class="center">Verify a pickup</h2>
      <p class="center muted">Ask the customer for their 4-digit BiteBack PIN.</p>
      <form id="pin-form" autocomplete="off">
        <div class="pin-entry">${[0, 1, 2, 3].map((i) => `<input inputmode="numeric" maxlength="1" aria-label="PIN digit ${i + 1}" data-i="${i}">`).join('')}</div>
        <button class="btn btn-green btn-block" type="submit">Find order</button>
      </form>
      <div id="pin-msg" style="margin-top:14px"></div>
      <div id="pin-result"></div>
    </div>`;
  const inputs = $$('.pin-entry input', panel);
  inputs[0].focus();
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && inputs[i + 1]) inputs[i + 1].focus();
      if (inputs.every((x) => x.value)) $('#pin-form').requestSubmit();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && inputs[i - 1]) inputs[i - 1].focus();
    });
    inp.addEventListener('paste', (e) => {
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
      if (digits.length === 4) {
        e.preventDefault();
        digits.split('').forEach((d, j) => (inputs[j].value = d));
        $('#pin-form').requestSubmit();
      }
    });
  });
  const pinValue = () => inputs.map((x) => x.value).join('');
  const reset = () => { inputs.forEach((x) => (x.value = '')); inputs[0].focus(); };

  $('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = pinValue();
    const result = $('#pin-result');
    try {
      const { order: o } = await api('/restaurant/pickup/lookup', { method: 'POST', body: { pin } });
      showError($('#pin-msg'), null);
      result.innerHTML = `
        <div class="card" style="box-shadow:none;background:var(--surface-2)">
          <div class="row"><span class="status reserved">Awaiting pickup</span><span class="spacer"></span><span class="muted small">Order #${o.id}</span></div>
          <h3 style="margin:10px 0 4px">${o.quantity} × ${esc(o.itemTitle)}</h3>
          <p class="muted small" style="margin:0 0 10px">Customer: <b>${esc(o.customerUsername)}</b> · Ordered ${fmtDateTime(o.createdAt)}</p>
          <table class="breakdown small">
            <tr><td>Food (${o.quantity} × ${money(o.unitPriceCents)})</td><td>${money(o.subtotalCents)}</td></tr>
            <tr><td>Service fee</td><td>${money(o.serviceFeeCents)}</td></tr>
            <tr><td>Sales tax</td><td>${money(o.taxCents)}</td></tr>
            <tr class="total"><td>Customer pays</td><td>${money(o.totalCents)}</td></tr>
          </table>
          <button class="btn btn-primary btn-block" id="confirm-pickup" style="margin-top:14px">Hand over food &amp; charge ${money(o.totalCents)}</button>
          <button class="btn btn-ghost btn-block" id="cancel-lookup" style="margin-top:8px">Not this order</button>
        </div>`;
      $('#cancel-lookup').addEventListener('click', () => { result.innerHTML = ''; reset(); });
      $('#confirm-pickup').addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
        try {
          const { order: done } = await api('/restaurant/pickup/confirm', { method: 'POST', body: { pin, orderId: o.id } });
          result.innerHTML = `<div class="center" style="padding:10px 0"><div class="success-check">✓</div>
            <h3>Pickup confirmed</h3><p class="muted">${done.quantity} × ${esc(done.itemTitle)} for ${esc(done.customerUsername)}.<br>
            Card charged ${money(done.totalCents)}.</p></div>`;
          reset();
          renderKpis();
        } catch (err) {
          showError($('#pin-msg'), err);
        }
      }));
    } catch (err) {
      result.innerHTML = '';
      showError($('#pin-msg'), err);
      reset();
    }
  });
}

// ---------- Offers ----------
const toLocalInput = (d) => {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
};

async function renderOffers(panel) {
  const { offers } = await api('/restaurant/offers');
  if (!offers.length) {
    panel.innerHTML = `<div class="empty"><img src="/assets/logo-mark.svg" alt=""><h3>No offers yet</h3>
      <p>Have a wrong order or extra food? Post it and let nearby customers rescue it.</p>
      <button class="btn btn-primary" data-new>Post surplus food</button></div>`;
    $('[data-new]', panel).addEventListener('click', () => offerForm());
    return;
  }
  panel.innerHTML = `<div class="card table-wrap" style="padding:8px"><table class="data">
    <thead><tr><th>Item</th><th>Price</th><th>Left</th><th>Pickup window</th><th>Status</th><th></th></tr></thead>
    <tbody>${offers.map((o) => {
      const price = Math.floor((o.original_price_cents * (100 - o.discount_pct)) / 100 + 0.5);
      return `<tr>
        <td><b>${esc(o.title)}</b><div class="small muted">${esc(config.reasons[o.reason])}${o.awaiting_pickup ? ` · ${o.awaiting_pickup} awaiting pickup` : ''}${o.picked_up ? ` · ${o.picked_up} picked up` : ''}</div></td>
        <td>${money(price)} <span class="was small">${money(o.original_price_cents)}</span><div class="small muted">${o.discount_pct}% off</div></td>
        <td>${o.quantity_available} / ${o.quantity_total}</td>
        <td class="small">${fmtWindow(o.pickup_start, o.pickup_end)}</td>
        <td><span class="status ${o.status}">${o.status}</span></td>
        <td style="white-space:nowrap">${o.status === 'ended' ? '' : `
          <button class="btn btn-ghost btn-sm" data-edit="${o.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-status="${o.status === 'active' ? 'paused' : 'active'}" data-id="${o.id}">${o.status === 'active' ? 'Pause' : 'Resume'}</button>
          <button class="btn btn-danger btn-sm" data-status="ended" data-id="${o.id}">End</button>`}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  panel.onclick = async (e) => {
    const edit = e.target.closest('[data-edit]');
    const st = e.target.closest('[data-status]');
    if (edit) offerForm(offers.find((o) => o.id === Number(edit.dataset.edit)));
    if (st) {
      if (st.dataset.status === 'ended' && !confirm('End this offer? It will no longer be visible to customers. Existing orders can still be picked up.')) return;
      try {
        await api(`/restaurant/offers/${st.dataset.id}/status`, { method: 'POST', body: { status: st.dataset.status } });
        renderOffers(panel);
        renderKpis();
      } catch (err) {
        toast(err.message);
      }
    }
  };
}

function offerForm(existing) {
  const now = new Date();
  const start = existing ? new Date(existing.pickup_start) : now;
  const end = existing ? new Date(existing.pickup_end) : new Date(now.getTime() + 3 * 3600000);
  const tags = existing?.dietary ? existing.dietary.split(',') : [];
  const modal = openModal(existing ? 'Edit offer' : 'Post surplus food', `
    <form id="offer-form" novalidate>
      <div class="field"><label for="o-title">Item name</label><input id="o-title" maxlength="80" value="${esc(existing?.title)}" placeholder="e.g. Chicken Pad Thai"></div>
      <div class="field"><label for="o-desc">Description</label><textarea id="o-desc" maxlength="500" placeholder="What's included, allergens, how it's packed…">${esc(existing?.description)}</textarea></div>
      <div class="field"><label for="o-reason">Why is it available?</label><select id="o-reason">
        ${Object.entries(config.reasons).map(([k, v]) => `<option value="${k}" ${existing?.reason === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="grid-3">
        <div class="field"><label for="o-price">Original price ($)</label><input id="o-price" inputmode="decimal" value="${existing ? (existing.original_price_cents / 100).toFixed(2) : ''}" placeholder="15.00"></div>
        <div class="field"><label for="o-disc">Discount (%)</label><input id="o-disc" type="number" min="1" max="90" value="${existing?.discount_pct ?? 50}"></div>
        <div class="field"><label for="o-qty">Quantity</label><input id="o-qty" type="number" min="1" max="500" value="${existing?.quantity_total ?? 1}"></div>
      </div>
      <div class="alert alert-info small" id="o-preview"></div>
      <div class="grid-2">
        <div class="field"><label for="o-start">Pickup from</label><input id="o-start" type="datetime-local" value="${toLocalInput(start)}"></div>
        <div class="field"><label for="o-end">Pickup until</label><input id="o-end" type="datetime-local" value="${toLocalInput(end)}"></div>
      </div>
      <div class="field"><label>Dietary tags</label><div class="chips">
        ${config.dietaryTags.map((t) => `<label class="check chip" style="padding:6px 10px"><input type="checkbox" value="${t}" ${tags.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div id="o-msg"></div>
      <button class="btn btn-primary btn-block" type="submit">${existing ? 'Save changes' : 'Post offer'}</button>
    </form>`);
  const b = modal.body;
  const preview = () => {
    const price = Number($('#o-price', b).value.replace(/[$,]/g, ''));
    const disc = Number($('#o-disc', b).value);
    $('#o-preview', b).innerHTML = price > 0 && disc >= 1 && disc <= 90
      ? `Customers pay <b>${money(Math.round(price * (100 - disc)))}</b> per item (plus ${pct(config.serviceFeeBps)} BiteBack service fee and ${pct(restaurant.tax_rate_bps)} sales tax).`
      : 'Enter the original price and a discount from 1% to 90%.';
  };
  b.addEventListener('input', preview);
  preview();
  $('#offer-form', b).addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {
      title: $('#o-title', b).value, description: $('#o-desc', b).value, reason: $('#o-reason', b).value,
      originalPrice: $('#o-price', b).value, discountPct: $('#o-disc', b).value, quantity: $('#o-qty', b).value,
      pickupStart: $('#o-start', b).value ? new Date($('#o-start', b).value).toISOString() : '',
      pickupEnd: $('#o-end', b).value ? new Date($('#o-end', b).value).toISOString() : '',
      dietary: $$('.chips input:checked', b).map((i) => i.value),
    };
    withBusy($('button[type=submit]', b), async () => {
      try {
        if (existing) await api(`/restaurant/offers/${existing.id}`, { method: 'PUT', body });
        else await api('/restaurant/offers', { method: 'POST', body });
        modal.close();
        toast(existing ? 'Offer updated' : 'Offer posted! Customers nearby can see it now.');
        renderKpis();
        showTab('offers');
      } catch (err) {
        showError($('#o-msg', b), err);
      }
    });
  });
}
$('#new-offer-btn').addEventListener('click', () => offerForm());

// ---------- Orders ----------
const ORDER_LABELS = { reserved: 'Awaiting pickup', picked_up: 'Picked up', cancelled: 'Cancelled', expired: 'Not picked up' };
async function renderOrders(panel) {
  const { orders } = await api('/restaurant/orders');
  panel.innerHTML = orders.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
    <thead><tr><th>#</th><th>Item</th><th>Customer</th><th>Food sales</th><th>Total charged</th><th>Status</th><th>When</th></tr></thead>
    <tbody>${orders.map((o) => `<tr>
      <td>${o.id}</td><td>${o.quantity} × ${esc(o.itemTitle)}</td><td>${esc(o.customerUsername)}</td>
      <td>${money(o.subtotalCents)}</td><td>${money(o.totalCents)}</td>
      <td><span class="status ${o.status}">${ORDER_LABELS[o.status] || o.status}</span></td>
      <td class="small">${fmtDateTime(o.pickedUpAt || o.createdAt)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No orders yet</h3><p>Orders appear here as soon as customers reserve your food.</p></div>';
}

// ---------- Profile ----------
function renderProfile(panel) {
  const r = restaurant;
  panel.innerHTML = `
    <form class="card" id="profile-form" style="max-width:720px" novalidate>
      <div class="grid-2">
        <div class="field"><label for="p-name">Restaurant name</label><input id="p-name" value="${esc(r.name)}"></div>
        <div class="field"><label for="p-cuisine">Cuisine</label><input id="p-cuisine" value="${esc(r.cuisine)}"></div>
      </div>
      <div class="field"><label for="p-desc">About</label><textarea id="p-desc" maxlength="400">${esc(r.description)}</textarea></div>
      <div class="field"><label for="p-address">Street address</label><input id="p-address" value="${esc(r.address)}"></div>
      <div class="grid-3">
        <div class="field"><label for="p-city">City</label><input id="p-city" value="${esc(r.city)}"></div>
        <div class="field"><label for="p-zip">ZIP</label><input id="p-zip" value="${esc(r.zip)}"></div>
        <div class="field"><label for="p-phone">Phone</label><input id="p-phone" value="${esc(r.phone)}"></div>
      </div>
      <div class="section-label">Map location</div>
      <p class="small muted">Lets customers sort deals by distance. Click the button while at the restaurant, or enter coordinates.</p>
      <div class="grid-3">
        <div class="field"><label for="p-lat">Latitude</label><input id="p-lat" value="${r.lat ?? ''}"></div>
        <div class="field"><label for="p-lng">Longitude</label><input id="p-lng" value="${r.lng ?? ''}"></div>
        <div class="field"><label>&nbsp;</label><button type="button" class="btn btn-ghost btn-block" id="p-locate">📍 Use my location</button></div>
      </div>
      <div class="section-label">Sales tax</div>
      <div class="field" style="max-width:240px"><label for="p-tax">Sales tax rate (%)</label><input id="p-tax" inputmode="decimal" value="${(r.tax_rate_bps / 100).toFixed(2)}">
        <div class="hint">Your combined WA state + local rate. <a href="https://dor.wa.gov/taxes-rates/sales-use-tax-rates/lookup-tax-rate" target="_blank" rel="noopener">Look up your rate</a>.</div></div>
      <div id="p-msg"></div>
      <button class="btn btn-green" type="submit">Save profile</button>
    </form>`;
  $('#p-locate').addEventListener('click', () => navigator.geolocation?.getCurrentPosition((pos) => {
    $('#p-lat').value = pos.coords.latitude.toFixed(5);
    $('#p-lng').value = pos.coords.longitude.toFixed(5);
  }, () => toast('Could not get your location.')));
  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {
      name: $('#p-name').value, cuisine: $('#p-cuisine').value, description: $('#p-desc').value, address: $('#p-address').value,
      city: $('#p-city').value, zip: $('#p-zip').value, phone: $('#p-phone').value, lat: $('#p-lat').value, lng: $('#p-lng').value,
      taxRatePct: $('#p-tax').value,
    };
    withBusy($('button[type=submit]', panel), async () => {
      try {
        ({ restaurant } = await api('/restaurant/profile', { method: 'PUT', body }));
        setTitle();
        showError($('#p-msg'), null);
        toast('Profile saved');
      } catch (err) {
        showError($('#p-msg'), err);
      }
    });
  });
}

renderKpis();
showTab('pickup');
setInterval(renderKpis, 30000);
