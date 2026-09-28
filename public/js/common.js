// Shared helpers for every page.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'BiteBack' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const money = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const pct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0).replace(/0$/, '')}%`;

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const fmtWindow = (start, end) => `${fmtDay(start)} ${fmtTime(start)} – ${fmtTime(end)}`;

export function fmtDateTime(iso) {
  return `${fmtDay(iso)}, ${fmtTime(iso)}`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let mePromise;
export function getMe() {
  mePromise ||= api('/auth/me').then((d) => d.user).catch(() => null);
  return mePromise;
}

// Redirects to login (or the right home page) unless the user has the given role.
export async function requireRole(role) {
  const user = await getMe();
  if (!user) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {});
  }
  if (role && user.role !== role) {
    location.href = homeFor(user);
    return new Promise(() => {});
  }
  return user;
}

export const homeFor = (user) => (user?.role === 'restaurant' ? '/restaurant/' : '/offers');

export async function renderHeader(active) {
  const el = document.getElementById('site-header');
  if (!el) return;
  const user = await getMe();
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  let links;
  if (!user) {
    links = link('/#how', 'How it works', 'how') + link('/#restaurants', 'For restaurants', 'rest') + link('/login', 'Log in', 'login') +
      '<a href="/signup" class="btn btn-primary btn-sm">Sign up free</a>';
  } else if (user.role === 'restaurant') {
    links = link('/restaurant/', 'Dashboard', 'dash') + `<span class="who">${esc(user.restaurant?.name || user.username)}</span>` +
      '<button class="linklike" id="logout-btn">Log out</button>';
  } else {
    links = link('/offers', 'Browse deals', 'offers') + link('/orders', 'My orders', 'orders') + link('/account', 'Account', 'account') +
      '<button class="linklike" id="logout-btn">Log out</button>';
  }
  el.className = 'site-header';
  el.innerHTML = `
    <div class="container">
      <a class="brand" href="${user ? homeFor(user) : '/'}" aria-label="BiteBack home">
        <img class="logo-light" src="/assets/logo.svg" alt="BiteBack"><img class="logo-dark" src="/assets/logo-dark.svg" alt="BiteBack">
      </a>
      <button class="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
      <nav class="nav">${links}</nav>
    </div>`;
  const nav = $('.nav', el);
  $('.nav-toggle', el).addEventListener('click', (e) => {
    nav.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open'));
  });
  $('#logout-btn', el)?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = '/';
  });
}

let toastTimer;
export function toast(message) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

export function showError(container, err) {
  container.innerHTML = err ? `<div class="alert alert-error" role="alert">${esc(err.message || err)}</div>` : '';
}

// Opens a modal. Returns { el, body, close }.
export function openModal(title, html, { onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="modal-close" aria-label="Close">×</button></div>
      <div class="modal-body">${html}</div>
    </div>`;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  $('.modal-close', backdrop).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  return { el: backdrop, body: $('.modal-body', backdrop), close };
}

export async function withBusy(button, fn) {
  const label = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'Please wait…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

const CUISINE_EMOJI = { vietnamese: '🍜', bakery: '🥐', mexican: '🌮', pizza: '🍕', indian: '🍛', hawaiian: '🐟', japanese: '🍣', thai: '🍲', chinese: '🥡', italian: '🍝', burgers: '🍔', american: '🍔', korean: '🍱', mediterranean: '🥙', cafe: '☕', dessert: '🍰', salad: '🥗' };
export const cuisineEmoji = (c) => CUISINE_EMOJI[String(c || '').toLowerCase()] || '🍽️';

const CUISINE_HUE = { vietnamese: 28, bakery: 40, mexican: 12, pizza: 0, indian: 30, hawaiian: 190, japanese: 340, thai: 60, chinese: 355, italian: 110, burgers: 20, american: 20, korean: 320, mediterranean: 80, cafe: 35, dessert: 300, salad: 100 };
export const cuisineHue = (c) => CUISINE_HUE[String(c || '').toLowerCase()] ?? 150;

export const pinTiles = (pin, cls = '') => `<div class="pin-tiles ${cls}" role="img" aria-label="PIN ${esc(pin.split('').join(' '))}">${pin.split('').map((d) => `<span>${esc(d)}</span>`).join('')}</div>`;
