import { api, $, $$, esc, money, pct, fmtWindow, fmtDateTime, fmtTime, renderHeader, requireRole, showError, openModal, withBusy, toast } from './common.js';
import { getConfig } from './cards.js';
import { ringBell, unlockOnInteraction, isUnlocked } from './bell.js';

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
const panels = { pickup: renderPickup, offers: renderOffers, menu: renderMenu, orders: renderOrders, profile: renderProfile };
let currentTab = 'pickup';
function showTab(name) {
  currentTab = name;
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
          <div class="row" style="flex-wrap:nowrap;margin-top:10px">${o.imageUrl ? `<img class="thumb" src="${esc(o.imageUrl)}" alt="">` : ''}
          <h3 style="margin:0">${o.quantity} × ${esc(o.itemTitle)}</h3></div>
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
        <td><div class="row" style="flex-wrap:nowrap;gap:12px">${o.image_path ? `<img class="thumb sm" src="${esc(o.image_path)}" alt="">` : ''}<div><b>${esc(o.title)}</b><div class="small muted">${esc(config.reasons[o.reason])}${o.awaiting_pickup ? ` · ${o.awaiting_pickup} awaiting pickup` : ''}${o.picked_up ? ` · ${o.picked_up} picked up` : ''}</div></div></div></td>
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

let menuCache = null;
async function loadMenu() {
  menuCache = (await api('/restaurant/menu')).items;
  return menuCache;
}

async function offerForm(existing, preselectId) {
  const menu = await loadMenu();
  if (!menu.length) {
    const modal = openModal('Post surplus food', `
      <div class="empty" style="padding:16px 0"><div style="font-size:48px">📋</div><h3>Add your menu first</h3>
      <p>Offers are picked from your menu, so customers see the real dish name, price and photo.</p>
      <button class="btn btn-primary" id="go-menu">Add menu items</button></div>`);
    $('#go-menu', modal.body).addEventListener('click', () => { modal.close(); showTab('menu'); menuItemForm(); });
    return;
  }
  const now = new Date();
  const start = existing ? new Date(existing.pickup_start) : now;
  const end = existing ? new Date(existing.pickup_end) : new Date(now.getTime() + 3 * 3600000);
  const selectedId = existing?.menu_item_id ?? preselectId ?? menu[0].id;
  const modal = openModal(existing ? 'Edit offer' : 'Post surplus food', `
    <form id="offer-form" novalidate>
      <div class="field"><label for="o-item">Menu item</label>
        <select id="o-item">${menu.map((m) => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)} (${money(m.price_cents)})</option>`).join('')}</select>
        <div class="hint">Not listed? <a href="#" id="o-add-item">Add it to your menu</a>.</div></div>
      <div class="item-preview" id="o-item-preview"></div>
      <div class="field"><label for="o-reason">Why is it available?</label><select id="o-reason">
        ${Object.entries(config.reasons).map(([k, v]) => `<option value="${k}" ${existing?.reason === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="o-desc">Note for customers <span class="muted">(optional)</span></label>
        <textarea id="o-desc" maxlength="500" placeholder="e.g. Customer ordered chicken instead. Broth packed separately.">${esc(existing && existing.description !== menu.find((m) => m.id === selectedId)?.description ? existing.description : '')}</textarea></div>
      <div class="grid-2">
        <div class="field"><label for="o-disc">Discount (%)</label><input id="o-disc" type="number" min="1" max="90" value="${existing?.discount_pct ?? 50}"></div>
        <div class="field"><label for="o-qty">Quantity available</label><input id="o-qty" type="number" min="1" max="500" value="${existing?.quantity_total ?? 1}"></div>
      </div>
      <div class="alert alert-info small" id="o-preview"></div>
      <div class="grid-2">
        <div class="field"><label for="o-start">Pickup from</label><input id="o-start" type="datetime-local" value="${toLocalInput(start)}"></div>
        <div class="field"><label for="o-end">Pickup until</label><input id="o-end" type="datetime-local" value="${toLocalInput(end)}"></div>
      </div>
      <div id="o-msg"></div>
      <button class="btn btn-primary btn-block" type="submit">${existing ? 'Save changes' : 'Post offer'}</button>
    </form>`);
  const b = modal.body;
  const current = () => menu.find((m) => m.id === Number($('#o-item', b).value));
  const preview = () => {
    const item = current();
    $('#o-item-preview', b).innerHTML = `
      ${item.image_path ? `<img class="thumb" src="${esc(item.image_path)}" alt="">` : '<div class="thumb" style="display:grid;place-items:center;font-size:30px">🍽️</div>'}
      <div><b>${esc(item.name)}</b><div class="small muted">${esc(item.description || 'No description')}</div>
        <div class="small" style="margin-top:4px">Menu price <b>${money(item.price_cents)}</b>${item.dietary ? ` · ${item.dietary.split(',').map((d) => `<span class="chip diet">${esc(d)}</span>`).join(' ')}` : ''}</div></div>`;
    const disc = Number($('#o-disc', b).value);
    $('#o-preview', b).innerHTML = disc >= 1 && disc <= 90
      ? `Customers pay <b>${money(Math.floor((item.price_cents * (100 - disc)) / 100 + 0.5))}</b> <span class="was">${money(item.price_cents)}</span> per item, plus ${pct(config.serviceFeeBps)} BiteBack service fee and ${pct(restaurant.tax_rate_bps)} sales tax.`
      : 'Enter a discount from 1% to 90%.';
  };
  b.addEventListener('input', preview);
  b.addEventListener('change', preview);
  preview();
  $('#o-add-item', b).addEventListener('click', (e) => { e.preventDefault(); modal.close(); showTab('menu'); menuItemForm(); });
  $('#offer-form', b).addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {
      menuItemId: Number($('#o-item', b).value), description: $('#o-desc', b).value, reason: $('#o-reason', b).value,
      discountPct: $('#o-disc', b).value, quantity: $('#o-qty', b).value,
      pickupStart: $('#o-start', b).value ? new Date($('#o-start', b).value).toISOString() : '',
      pickupEnd: $('#o-end', b).value ? new Date($('#o-end', b).value).toISOString() : '',
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

// ---------- Menu ----------
async function renderMenu(panel) {
  const items = await loadMenu();
  panel.innerHTML = `
    <p class="muted" style="margin-top:-6px">Your menu, with photos. When you post surplus food, you pick the dish from here.</p>
    <div class="menu-grid">
      <button class="menu-card add" id="add-item" type="button"><div><div style="font-size:34px">＋</div>Add menu item</div></button>
      ${items.map((m) => `
      <div class="menu-card">
        <div class="pic">${m.image_path ? `<img src="${esc(m.image_path)}" alt="${esc(m.name)}" loading="lazy">` : '📷'}</div>
        <div class="body">
          <h3>${esc(m.name)}</h3>
          <div class="price" style="font-size:1.1rem">${money(m.price_cents)}</div>
          ${m.dietary ? `<div class="chips">${m.dietary.split(',').map((d) => `<span class="chip diet">${esc(d)}</span>`).join('')}</div>` : ''}
          <div class="actions">
            <button class="btn btn-primary btn-sm" data-offer="${m.id}">Discount it</button>
            <button class="btn btn-ghost btn-sm" data-edit-item="${m.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del-item="${m.id}" aria-label="Remove ${esc(m.name)}">✕</button>
          </div>
        </div>
      </div>`).join('')}
    </div>`;
  $('#add-item', panel).addEventListener('click', () => menuItemForm());
  panel.onclick = async (e) => {
    const find = (attr) => items.find((m) => m.id === Number(e.target.closest(`[${attr}]`)?.getAttribute(attr)));
    const offerItem = find('data-offer');
    const editItem = find('data-edit-item');
    const delItem = find('data-del-item');
    if (offerItem) offerForm(undefined, offerItem.id);
    if (editItem) menuItemForm(editItem);
    if (delItem && confirm(`Remove "${delItem.name}" from your menu? Current offers stay live.`)) {
      await api(`/restaurant/menu/${delItem.id}`, { method: 'DELETE' });
      toast('Menu item removed');
      renderMenu(panel);
    }
  };
}

// Resizes a chosen photo in the browser so uploads stay small (max 1200px, JPEG).
function resizeImage(file, max = 1200) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Please choose a JPEG, PNG or WebP photo.'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that photo.'));
    img.src = url;
  });
}

function menuItemForm(existing) {
  const tags = existing?.dietary ? existing.dietary.split(',') : [];
  const modal = openModal(existing ? 'Edit menu item' : 'Add menu item', `
    <form id="item-form" novalidate>
      <div class="field"><label>Photo</label>
        <div class="photo-picker">
          <div class="preview" id="i-preview">${existing?.image_path ? `<img src="${esc(existing.image_path)}" alt="">` : '📷'}</div>
          <div><label class="btn btn-ghost btn-sm" style="margin:0">Choose photo<input type="file" id="i-file" accept="image/jpeg,image/png,image/webp" hidden></label>
            <div class="hint">A bright, close-up photo sells best. JPEG, PNG or WebP.</div></div>
        </div></div>
      <div class="field"><label for="i-name">Dish name</label><input id="i-name" maxlength="80" value="${esc(existing?.name)}" placeholder="e.g. Chicken Pad Thai"></div>
      <div class="field"><label for="i-desc">Description</label><textarea id="i-desc" maxlength="500" placeholder="Ingredients, portion size, allergens…">${esc(existing?.description)}</textarea></div>
      <div class="field" style="max-width:200px"><label for="i-price">Menu price ($)</label><input id="i-price" inputmode="decimal" value="${existing ? (existing.price_cents / 100).toFixed(2) : ''}" placeholder="15.00"></div>
      <div class="field"><label>Dietary tags</label><div class="chips">
        ${config.dietaryTags.map((t) => `<label class="check chip" style="padding:6px 10px"><input type="checkbox" value="${t}" ${tags.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div id="i-msg"></div>
      <button class="btn btn-primary btn-block" type="submit">${existing ? 'Save item' : 'Add to menu'}</button>
    </form>`);
  const b = modal.body;
  let image = null;
  $('#i-file', b).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      image = await resizeImage(file);
      $('#i-preview', b).innerHTML = `<img src="${image}" alt="">`;
      showError($('#i-msg', b), null);
    } catch (err) {
      showError($('#i-msg', b), err);
    }
  });
  $('#item-form', b).addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {
      name: $('#i-name', b).value, description: $('#i-desc', b).value, price: $('#i-price', b).value,
      dietary: $$('.chips input:checked', b).map((i) => i.value), image: image || undefined,
    };
    withBusy($('button[type=submit]', b), async () => {
      try {
        if (existing) await api(`/restaurant/menu/${existing.id}`, { method: 'PUT', body });
        else await api('/restaurant/menu', { method: 'POST', body });
        modal.close();
        toast(existing ? 'Menu item saved' : 'Added to your menu');
        showTab('menu');
      } catch (err) {
        showError($('#i-msg', b), err);
      }
    });
  });
}

// ---------- Live order alerts ----------
let soundOn = true;
try { soundOn = localStorage.getItem('bb-sound') !== 'off'; } catch { /* ignore */ }
const soundBtn = $('#sound-btn');
const syncSound = () => {
  soundBtn.textContent = soundOn ? '🔔 Order sound: on' : '🔕 Order sound: off';
  soundBtn.classList.toggle('off', !soundOn);
  $('#sound-banner').classList.toggle('hidden', !soundOn || isUnlocked());
};
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem('bb-sound', soundOn ? 'on' : 'off'); } catch { /* ignore */ }
  syncSound();
  if (soundOn) setTimeout(() => ringBell(), 50);
});
unlockOnInteraction(syncSound);
syncSound();

const baseTitle = document.title;
let flash;
function announceOrder(order) {
  if (soundOn) ringBell();
  document.querySelector('.new-order')?.remove();
  const el = document.createElement('div');
  el.className = 'new-order';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="inner">
    ${order.imageUrl ? `<img class="thumb sm" src="${esc(order.imageUrl)}" alt="">` : '<span class="bell">🛎️</span>'}
    <div style="flex:1"><b>New order!</b><div class="small">${order.quantity} × ${esc(order.itemTitle)}</div>
      <div class="small muted">${esc(order.customerUsername)} · ${money(order.totalCents)} · pick up by ${fmtTime(order.pickupEnd)}</div></div>
    <span class="bell" aria-hidden="true">🔔</span></div>`;
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  setTimeout(() => el.remove(), 12000);
  clearInterval(flash);
  let on = false;
  let n = 0;
  flash = setInterval(() => {
    document.title = (on = !on) ? '🔔 New order! · BiteBack' : baseTitle;
    if (++n > 12 || document.hasFocus()) { clearInterval(flash); document.title = baseTitle; }
  }, 1000);
  renderKpis();
  if (currentTab === 'orders' || currentTab === 'offers') showTab(currentTab);
}

const stream = new EventSource('/api/restaurant/events');
stream.addEventListener('order', (e) => announceOrder(JSON.parse(e.data)));

$('#new-offer-btn').addEventListener('click', () => offerForm());

// ---------- Orders ----------
const ORDER_LABELS = { reserved: 'Awaiting pickup', picked_up: 'Picked up', cancelled: 'Cancelled', expired: 'Not picked up' };
async function renderOrders(panel) {
  const { orders } = await api('/restaurant/orders');
  panel.innerHTML = orders.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
    <thead><tr><th>#</th><th>Item</th><th>Customer</th><th>Food sales</th><th>Total charged</th><th>Status</th><th>When</th></tr></thead>
    <tbody>${orders.map((o) => `<tr>
      <td>${o.id}</td><td><div class="row" style="flex-wrap:nowrap;gap:10px">${o.imageUrl ? `<img class="thumb sm" src="${esc(o.imageUrl)}" alt="">` : ''}<span>${o.quantity} × ${esc(o.itemTitle)}</span></div></td><td>${esc(o.customerUsername)}</td>
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
