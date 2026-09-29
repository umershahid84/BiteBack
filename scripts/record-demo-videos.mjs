// Records the short "See BiteBack in action" tours shown in the app (public/videos/).
//
//   npm run db:reset && npm run seed && npm run dev      (fresh demo data, app on :3000)
//   node scripts/record-demo-videos.mjs                   (writes raw .webm files to ./.video-tmp)
//   then encode them for the web (any ffmpeg with libx264 and libvpx-vp9), for each of customer / restaurant:
//     ffmpeg -ss 0.6 -i .video-tmp/customer-raw.webm -an -vf fps=25,format=yuv420p -c:v libx264 -preset slow -crf 27 \
//       -tune stillimage -movflags +faststart public/videos/customer-tour.mp4
//     ffmpeg -ss 0.6 -i .video-tmp/customer-raw.webm -an -vf fps=25 -c:v libvpx-vp9 -crf 40 -b:v 0 -row-mt 1 public/videos/customer-tour.webm
//     ffmpeg -ss 32 -i public/videos/customer-tour.mp4 -frames:v 1 -q:v 4 public/videos/customer-tour.jpg   (poster)
//   and update the lengths in src/components/app/demo-video.tsx if they changed.
//
// The recording shows a visible pointer and a caption bar so viewers can follow without sound.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';
const OUT = path.resolve('.video-tmp');
const SIZE = { width: 1280, height: 720 };
const PASSWORD = 'BiteBack123';
fs.mkdirSync(OUT, { recursive: true });

// Pointer, click ripple and caption bar, injected into every page.
const OVERLAY = () => {
  const css = `
    nextjs-portal { display: none !important; }
    #bb-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(255,255,255,.9); border: 3px solid #10b981; box-shadow: 0 2px 10px rgba(0,0,0,.5); pointer-events: none;
      transition: transform .12s; left: -40px; top: -40px; }
    #bb-cursor.down { transform: scale(.7); }
    .bb-ripple { position: fixed; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      border: 3px solid #34d399; pointer-events: none; animation: bb-rip .5s ease-out forwards; }
    @keyframes bb-rip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    #bb-caption { position: fixed; z-index: 2147483645; left: 50%; bottom: 26px; transform: translateX(-50%); max-width: 1000px;
      padding: 12px 22px; border-radius: 999px; background: rgba(4,19,13,.92); border: 1px solid rgba(16,185,129,.55);
      color: #ecfdf5; font: 700 21px/1.3 Inter, system-ui, sans-serif; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,.5);
      pointer-events: none; transition: opacity .25s; }
    #bb-caption:empty { opacity: 0; }
    #bb-caption b { color: #6ee7b7; }`;
  const add = () => {
    if (document.getElementById('bb-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const cursor = Object.assign(document.createElement('div'), { id: 'bb-cursor' });
    const caption = Object.assign(document.createElement('div'), { id: 'bb-caption' });
    caption.innerHTML = sessionStorage.getItem('bb-caption') ?? '';
    document.body.append(cursor, caption);
    const pos = JSON.parse(sessionStorage.getItem('bb-pos') ?? '[-40,-40]');
    cursor.style.left = `${pos[0]}px`;
    cursor.style.top = `${pos[1]}px`;
    addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      sessionStorage.setItem('bb-pos', JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener('mousedown', (e) => {
      cursor.classList.add('down');
      const r = Object.assign(document.createElement('div'), { className: 'bb-ripple' });
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.append(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  };
  window.__bbCaption = (html) => {
    sessionStorage.setItem('bb-caption', html);
    const el = document.getElementById('bb-caption');
    if (el) el.innerHTML = html;
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add);
  else add();
  // Client-side navigation can replace <body> content; re-add if it disappears.
  setInterval(add, 300);
};

const wait = (p, ms) => p.waitForTimeout(ms);
const caption = async (p, html, ms = 0) => {
  await p.evaluate((h) => window.__bbCaption(h), html);
  if (ms) await wait(p, ms);
};

// Moves the visible pointer to an element (smoothly), then clicks it.
async function click(p, target, { pause = 350 } = {}) {
  const loc = typeof target === 'string' ? p.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await wait(p, pause);
  await loc.click();
}

async function type(p, selector, text, delay = 55) {
  await click(p, selector, { pause: 150 });
  await p.locator(selector).first().pressSequentially(text, { delay });
}

async function scrollBy(p, dy, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await p.mouse.wheel(0, dy / steps);
    await wait(p, 35);
  }
}

async function logIn(p, user) {
  await p.goto(`${BASE}/login`);
  await type(p, '#login', user);
  await type(p, '#password', PASSWORD, 30);
  await click(p, 'button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function recordingContext(browser) {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, deviceScaleFactor: 1, timezoneId: 'America/Los_Angeles' });
  await ctx.addInitScript(OVERLAY);
  return ctx;
}

async function customerTour(browser) {
  const ctx = await recordingContext(browser);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await wait(p, 600);
  await caption(p, 'Local restaurants post <b>surplus food</b> at up to 70% off', 2600);
  await caption(p, 'Create a free account, then log in');
  await logIn(p, 'demo');
  await p.waitForSelector('article');
  await caption(p, 'Browse <b>live deals</b> nearby, with a countdown before the food is discarded', 2200);
  await scrollBy(p, 260);
  await wait(p, 900);
  await caption(p, 'Search by dish, city or ZIP code');
  await type(p, 'input[aria-label="Search"]', 'Beef Pho', 70);
  await wait(p, 1400);
  await click(p, 'article button:has-text("Order")');
  await p.waitForSelector('text=Order summary');
  await caption(p, 'Choose how many you want (never more than the restaurant has left)', 300);
  for (let i = 0; i < 2; i++) {
    const more = p.locator('button[aria-label="More"]');
    if (await more.isEnabled()) await click(p, more, { pause: 200 });
    await wait(p, 350);
  }
  await caption(p, 'See the <b>full total</b> before you order: food + 5% service fee + WA tax', 2400);
  await scrollBy(p, 360);
  await caption(p, 'Use your BiteBack credit, and pay the rest with a saved or new card', 1400);
  const newCard = p.locator('label:has-text("Use a new card")');
  if (await newCard.count()) {
    await click(p, newCard.first());
    await type(p, '#cc-num', '4242424242424242', 25);
    await type(p, '#cc-exp', '1230', 60);
    await type(p, '#cc-cvc', '123', 60);
  }
  await caption(p, 'Your card is only <b>held</b> now, and charged when you pick up', 1200);
  await click(p, 'button:has-text("Place order")');
  await p.waitForSelector('text=Congratulations', { timeout: 20000 });
  await caption(p, 'Done! Show this <b>4-digit PIN</b> at the counter', 3400);
  const pin = (await p.locator('[aria-label^="PIN "]').first().getAttribute('aria-label')).replace(/\D/g, '');
  await click(p, 'a:has-text("View my orders")');
  await p.waitForSelector('text=Pickup PIN');
  await caption(p, 'Your orders and PINs are always under <b>My orders</b>', 2200);
  await click(p, 'a:has-text("View receipt")');
  await p.waitForSelector('.pos');
  await caption(p, 'Every order has a receipt you can print or download', 1200);
  await scrollBy(p, 600, 24);
  await wait(p, 1200);
  await caption(p, '<b>BiteBack</b>: rescue great food, save money', 2200);
  await ctx.close();
  return { pin };
}

async function restaurantTour(browser) {
  const ctx = await recordingContext(browser);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await caption(p, 'For restaurants: turn surplus food into revenue in under a minute');
  await wait(p, 1800);
  await logIn(p, 'harborpho');
  await p.waitForSelector('text=Verify a pickup');
  await p.mouse.click(1200, 690); // one click turns on the order bell
  await caption(p, 'Your dashboard: pickups, offers, menu, orders and payouts', 2400);
  await click(p, 'button:has-text("Post surplus food")');
  await p.waitForSelector('#o-item');
  await caption(p, 'Pick a dish from your menu and choose your discount');
  await p.locator('#o-item').selectOption({ label: 'Fresh Spring Rolls (3) ($8.50)' });
  await p.locator('#o-reason').selectOption('overproduction');
  await wait(p, 600);
  await click(p, '#o-disc', { pause: 150 });
  await p.locator('#o-disc').fill('50');
  await click(p, '#o-qty', { pause: 150 });
  await p.locator('#o-qty').fill('4');
  await p.locator('#o-qty').blur(); // a wheel scroll over a focused number field would change it
  await caption(p, 'Set how many are available and a <b>discard timer</b>', 900);
  await scrollBy(p, 300);
  await click(p, 'button:has-text("2 hours")');
  await wait(p, 800);
  await click(p, 'button:has-text("Post offer")');
  await p.waitForSelector('[role=tab][data-state=active]:has-text("Offers")');
  await caption(p, 'It goes live for nearby customers right away', 2600);

  // A customer orders (in another, unrecorded browser) and the bell rings live.
  const other = await browser.newContext({ viewport: SIZE, timezoneId: 'America/Los_Angeles' });
  const c = await other.newPage();
  await c.goto(`${BASE}/login`);
  await c.fill('#login', 'demo');
  await c.fill('#password', PASSWORD);
  await c.click('button[type=submit]');
  await c.waitForURL('**/offers');
  await c.fill('input[aria-label="Search"]', 'Spring Rolls');
  await c.waitForTimeout(1500);
  await c.click('article button:has-text("Order")');
  await c.waitForSelector('text=Order summary');
  await c.waitForTimeout(800);
  await caption(p, 'When a customer orders, a <b>bell rings</b> and the order pops up', 0);
  await c.click('button:has-text("Place order")');
  await c.waitForSelector('text=Congratulations', { timeout: 20000 });
  const pin = (await c.locator('[aria-label^="PIN "]').first().getAttribute('aria-label')).replace(/\D/g, '');
  await other.close();
  await p.waitForSelector('text=New order!', { timeout: 20000 });
  await wait(p, 2600);

  await click(p, '[role=tab]:has-text("Verify pickup")');
  await caption(p, 'At pickup, type the customer’s <b>PIN</b>');
  await wait(p, 600);
  for (const [i, d] of pin.split('').entries()) {
    await click(p, `input[data-i="${i}"]`, { pause: 120 });
    await p.keyboard.type(d, { delay: 150 });
  }
  await p.waitForSelector('text=Hand over food');
  await wait(p, 1400);
  await caption(p, 'Hand over the food: the card is charged and <b>you get paid through Stripe</b>', 400);
  await click(p, 'button:has-text("Hand over food")');
  await p.waitForSelector('text=Pickup confirmed');
  await wait(p, 2200);
  await click(p, '[role=tab]:has-text("Payouts")');
  await p.waitForSelector('text=Payout history');
  await caption(p, 'Every payout has an invoice number and transaction ID', 2800);
  await click(p, 'a:has-text("Daily report")');
  await p.waitForSelector('text=Daily sales report');
  await caption(p, 'Daily reports to print, or download as PDF or CSV', 2400);
  await caption(p, '<b>BiteBack</b>: less waste, more revenue', 2000);
  await ctx.close();
  return { pin };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const ctxVideos = [];
  const before = new Set(fs.readdirSync(OUT));
  await customerTour(browser);
  const customerFile = fs.readdirSync(OUT).find((f) => !before.has(f));
  ctxVideos.push(['customer', customerFile]);
  const before2 = new Set(fs.readdirSync(OUT));
  await restaurantTour(browser);
  const restaurantFile = fs.readdirSync(OUT).find((f) => !before2.has(f));
  ctxVideos.push(['restaurant', restaurantFile]);
  for (const [name, file] of ctxVideos) fs.renameSync(path.join(OUT, file), path.join(OUT, `${name}-raw.webm`));
  console.log('Recorded:', ctxVideos.map(([n]) => `${OUT}/${n}-raw.webm`).join(', '));
} finally {
  await browser.close();
}
