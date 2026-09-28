// Customer receipts and restaurant daily reports: JSON for the web pages, plus PDF and CSV downloads.
const path = require('node:path');
const PDFDocument = require('pdfkit');

const ROOT = path.join(__dirname, '..', 'public');
// WOFF (not WOFF2): pdfkit's font subsetter can fail on WOFF2 input.
const FONT_DIR = path.join(__dirname, 'fonts');
const FONTS = {
  regular: path.join(FONT_DIR, 'inter-latin-400-normal.woff'),
  medium: path.join(FONT_DIR, 'inter-latin-600-normal.woff'),
  bold: path.join(FONT_DIR, 'inter-latin-700-normal.woff'),
  head: path.join(FONT_DIR, 'plus-jakarta-sans-latin-800-normal.woff'),
};
const LOGO = path.join(ROOT, 'assets', 'logo.png');
const GREEN = '#047857';
const INK = '#0b1b14';
const MUTED = '#6b7b73';
const LINE = '#dfe7e2';

const money = (cents) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const pctText = (bps) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

function formatDateTime(iso, timeZone) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
const formatTime = (iso, timeZone) => new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

// UTC offset (ms) of a time zone at a given instant.
function tzOffset(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

// Start/end instants of a calendar day (YYYY-MM-DD) in the given time zone.
function dayRange(date, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const at = (day) => {
    const guess = Date.UTC(y, m - 1, day);
    return new Date(guess - tzOffset(guess - tzOffset(guess, timeZone), timeZone));
  };
  return { start: at(d).toISOString(), end: at(d + 1).toISOString() };
}

function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const PAYMENT_STATUS = {
  picked_up: 'Paid (charged at pickup)',
  reserved: 'Authorized: hold placed, charged at pickup',
  pending_payment: 'Processing',
  cancelled: 'Hold released: not charged',
  expired: 'Hold released: not charged',
  failed: 'Declined: not charged',
};
const ORDER_STATUS = {
  picked_up: 'Picked up', reserved: 'Awaiting pickup', pending_payment: 'Processing',
  cancelled: 'Cancelled', expired: 'Not picked up', failed: 'Payment failed',
};

function createReceiptService({ db, config }) {
  const timeZone = config.timeZone || 'America/Los_Angeles';

  function receiptData(order) {
    const r = db.prepare('SELECT name, address, city, zip, phone FROM restaurants WHERE id = ?').get(order.restaurant_id);
    const u = db.prepare('SELECT username, email FROM users WHERE id = ?').get(order.user_id);
    const offer = db.prepare('SELECT reason, image_path FROM offers WHERE id = ?').get(order.offer_id);
    const created = new Date(order.created_at);
    const ymd = `${created.getUTCFullYear()}${String(created.getUTCMonth() + 1).padStart(2, '0')}${String(created.getUTCDate()).padStart(2, '0')}`;
    const lineOriginal = order.original_unit_price_cents * order.quantity;
    return {
      receiptNumber: `BB-${ymd}-${String(order.id).padStart(6, '0')}`,
      orderId: order.id,
      status: order.status,
      statusLabel: ORDER_STATUS[order.status] || order.status,
      paymentStatus: order.refunded_cents
        ? (order.refunded_cents >= order.total_cents ? 'Refunded in full' : `Paid, partially refunded (${money(order.refunded_cents)})`)
        : PAYMENT_STATUS[order.status] || order.status,
      orderedAt: order.created_at,
      pickedUpAt: order.picked_up_at,
      closedAt: order.closed_at,
      pickupBy: order.pickup_end,
      orderedAtText: formatDateTime(order.created_at, timeZone),
      pickedUpAtText: formatDateTime(order.picked_up_at, timeZone),
      closedAtText: formatDateTime(order.closed_at, timeZone),
      pickupByText: formatDateTime(order.pickup_end, timeZone),
      customer: { username: u?.username || '', email: u?.email || '' },
      restaurant: r,
      item: {
        title: order.item_title,
        imageUrl: offer?.image_path || null,
        quantity: order.quantity,
        originalUnitCents: order.original_unit_price_cents,
        discountPct: order.discount_pct,
        unitPriceCents: order.unit_price_cents,
        lineOriginalCents: lineOriginal,
        lineTotalCents: order.subtotal_cents,
        savingsCents: lineOriginal - order.subtotal_cents,
      },
      subtotalCents: order.subtotal_cents,
      serviceFeeCents: order.service_fee_cents,
      serviceFeePct: order.subtotal_cents ? Math.round((order.service_fee_cents * 1000) / order.subtotal_cents) / 10 : 0,
      taxRateBps: order.tax_rate_bps,
      taxCents: order.tax_cents,
      totalCents: order.total_cents,
      amountChargedCents: order.status === 'picked_up' ? order.total_cents : 0,
      refundedCents: order.refunded_cents || 0,
      refundedAtText: formatDateTime(order.refunded_at, timeZone),
      card: order.card_label,
      paymentRef: order.payment_ref || '',
      pin: order.status === 'reserved' ? order.pin : null,
      timeZone,
    };
  }

  function receiptPdf(rc) {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `BiteBack receipt ${rc.receiptNumber}`, Author: 'BiteBack' } });
    fonts(doc);
    const L = 54;
    const R = doc.page.width - 54;
    const W = R - L;

    doc.image(LOGO, L, 48, { height: 44 });
    doc.font('head').fontSize(22).fillColor(INK).text('Receipt', L, 52, { width: W, align: 'right' });
    doc.font('regular').fontSize(9.5).fillColor(MUTED).text(rc.receiptNumber, L, 80, { width: W, align: 'right' });
    rule(doc, L, R, 110);

    // Restaurant / customer columns
    let y = 124;
    const col = W / 2;
    label(doc, 'RESTAURANT', L, y);
    label(doc, 'CUSTOMER', L + col, y);
    y += 14;
    doc.font('bold').fontSize(11.5).fillColor(INK).text(rc.restaurant.name, L, y, { width: col - 10 });
    doc.text(rc.customer.username, L + col, y, { width: col });
    y += 16;
    doc.font('regular').fontSize(9.5).fillColor(MUTED);
    doc.text(`${rc.restaurant.address}\n${rc.restaurant.city}, WA ${rc.restaurant.zip}${rc.restaurant.phone ? `\n${rc.restaurant.phone}` : ''}`, L, y, { width: col - 10 });
    doc.text(rc.customer.email, L + col, y, { width: col });
    y += 50;

    // Order facts
    const facts = [
      ['Order #', String(rc.orderId)],
      ['Ordered', rc.orderedAtText],
      [rc.status === 'picked_up' ? 'Picked up' : 'Pick up by', rc.status === 'picked_up' ? rc.pickedUpAtText : rc.pickupByText],
      ['Status', rc.statusLabel],
    ];
    const fw = W / facts.length;
    doc.roundedRect(L, y, W, 46, 8).fill('#f2f7f4');
    facts.forEach(([k, v], i) => {
      label(doc, k.toUpperCase(), L + 12 + i * fw, y + 9);
      doc.font('medium').fontSize(10).fillColor(INK).text(v, L + 12 + i * fw, y + 23, { width: fw - 16 });
    });
    y += 66;

    // Item table
    const cols = [
      ['Item', L, 190, 'left'], ['Qty', L + 190, 40, 'right'], ['Original', L + 230, 72, 'right'],
      ['Discount', L + 302, 62, 'right'], ['Price', L + 364, 70, 'right'], ['Amount', L + 434, W - 434, 'right'],
    ];
    cols.forEach(([h, x, w, a]) => label(doc, h.toUpperCase(), x, y, { width: w, align: a }));
    y += 16;
    rule(doc, L, R, y);
    y += 10;
    const it = rc.item;
    doc.font('bold').fontSize(10.5).fillColor(INK).text(it.title, L, y, { width: 185 });
    const rowH = Math.max(doc.heightOfString(it.title, { width: 185 }), 14);
    doc.font('regular').fontSize(10.5).text(String(it.quantity), L + 190, y, { width: 40, align: 'right' });
    const orig = money(it.originalUnitCents);
    doc.fillColor(MUTED).text(orig, L + 230, y, { width: 72, align: 'right' });
    const ow = doc.widthOfString(orig);
    doc.moveTo(L + 302 - ow, y + 6).lineTo(L + 302, y + 6).lineWidth(0.8).strokeColor(MUTED).stroke();
    doc.fillColor(GREEN).font('bold').text(`-${it.discountPct}%`, L + 302, y, { width: 62, align: 'right' });
    doc.fillColor(INK).text(money(it.unitPriceCents), L + 364, y, { width: 70, align: 'right' });
    doc.text(money(it.lineTotalCents), L + 434, y, { width: W - 434, align: 'right' });
    y += rowH + 4;
    doc.font('regular').fontSize(9).fillColor(GREEN).text(`You saved ${money(it.savingsCents)} (${it.discountPct}% off ${money(it.lineOriginalCents)})`, L, y);
    y += 20;
    rule(doc, L, R, y);
    y += 12;

    // Totals
    const tx = L + W / 2;
    const tw = W / 2;
    const totalRow = (k, v, opts = {}) => {
      doc.font(opts.bold ? 'bold' : 'regular').fontSize(opts.size || 10.5).fillColor(opts.color || INK);
      doc.text(k, tx, y, { width: tw * 0.6 });
      doc.text(v, tx + tw * 0.6, y, { width: tw * 0.4, align: 'right' });
      y += (opts.size || 10.5) + 9;
    };
    totalRow('Menu value', money(it.lineOriginalCents), { color: MUTED });
    totalRow(`Discount (${it.discountPct}%)`, money(-it.savingsCents), { color: GREEN });
    totalRow('Food subtotal', money(rc.subtotalCents));
    totalRow(`Service fee (${rc.serviceFeePct}%)`, money(rc.serviceFeeCents));
    totalRow(`WA sales tax (${pctText(rc.taxRateBps)})`, money(rc.taxCents));
    rule(doc, tx, R, y - 3);
    y += 4;
    totalRow('Total', money(rc.totalCents), { bold: true, size: 14 });
    y += 6;

    // Payment block
    doc.roundedRect(L, y, W, 78, 8).lineWidth(1).strokeColor(LINE).stroke();
    label(doc, 'PAYMENT', L + 14, y + 12);
    const pay = [
      ['Card', rc.card || 'n/a'],
      ['Payment status', rc.paymentStatus],
      ['Amount charged', rc.refundedCents ? `${money(rc.amountChargedCents)} (refunded ${money(rc.refundedCents)})` : money(rc.amountChargedCents)],
      ['Transaction ID', rc.paymentRef || 'n/a'],
    ];
    pay.forEach(([k, v], i) => {
      const px = L + 14 + (i % 2) * (W / 2);
      const py = y + 28 + Math.floor(i / 2) * 22;
      doc.font('regular').fontSize(9).fillColor(MUTED).text(`${k}: `, px, py, { continued: true });
      doc.font('medium').fillColor(INK).text(v, { width: W / 2 - 24 });
    });
    y += 96;

    if (rc.pin) {
      doc.roundedRect(L, y, W, 40, 8).fill('#ecfdf5');
      doc.font('regular').fontSize(10).fillColor(INK).text('Pickup PIN: show at the counter', L + 14, y + 14);
      doc.font('head').fontSize(18).fillColor(GREEN).text(rc.pin.split('').join(' '), L, y + 10, { width: W - 14, align: 'right' });
      y += 56;
    }

    doc.font('regular').fontSize(8.5).fillColor(MUTED).text(
      'Thank you for rescuing food with BiteBack! Your card is authorized when you order and charged only when the restaurant confirms pickup with your PIN. '
      + 'Orders not picked up are released without charge. Times shown in Pacific Time. Questions? Reply to your order email or contact support@biteback.app.',
      L, y, { width: W, lineGap: 2 },
    );
    return finish(doc);
  }

  // ----- Restaurant daily report -----

  function reportData(restaurantId, date) {
    const { start, end } = dayRange(date, timeZone);
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
    const rows = db.prepare(`
      SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.restaurant_id = ? AND o.status NOT IN ('pending_payment', 'failed')
        AND ((o.created_at >= ? AND o.created_at < ?) OR (o.picked_up_at >= ? AND o.picked_up_at < ?))
      ORDER BY o.created_at`).all(restaurantId, start, end, start, end);
    const sold = rows.filter((o) => o.status === 'picked_up' && o.picked_up_at >= start && o.picked_up_at < end);
    const sum = (list, f) => list.reduce((n, o) => n + f(o), 0);
    const count = (s) => rows.filter((o) => o.status === s).length;
    return {
      date,
      dateText: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
      generatedAtText: formatDateTime(new Date().toISOString(), timeZone),
      restaurant: { name: restaurant.name, address: restaurant.address, city: restaurant.city, zip: restaurant.zip, phone: restaurant.phone },
      summary: {
        ordersPickedUp: sold.length,
        mealsRescued: sum(sold, (o) => o.quantity),
        menuValueCents: sum(sold, (o) => o.original_unit_price_cents * o.quantity),
        discountsCents: sum(sold, (o) => (o.original_unit_price_cents - o.unit_price_cents) * o.quantity),
        foodSalesCents: sum(sold, (o) => o.subtotal_cents),
        salesTaxCents: sum(sold, (o) => o.tax_cents),
        serviceFeesCents: sum(sold, (o) => o.service_fee_cents),
        totalChargedCents: sum(sold, (o) => o.total_cents),
        awaitingPickup: count('reserved'),
        cancelled: count('cancelled'),
        notPickedUp: count('expired'),
      },
      orders: rows.map((o) => ({
        id: o.id,
        orderedAt: o.created_at,
        orderedTime: formatTime(o.created_at, timeZone),
        pickedUpTime: o.picked_up_at ? formatTime(o.picked_up_at, timeZone) : '',
        customer: o.username,
        item: o.item_title,
        quantity: o.quantity,
        originalUnitCents: o.original_unit_price_cents,
        discountPct: o.discount_pct,
        unitPriceCents: o.unit_price_cents,
        subtotalCents: o.subtotal_cents,
        taxCents: o.tax_cents,
        serviceFeeCents: o.service_fee_cents,
        totalCents: o.total_cents,
        card: o.card_label,
        status: o.status,
        statusLabel: ORDER_STATUS[o.status] || o.status,
      })),
    };
  }

  function reportCsv(rep) {
    const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const d = (c) => (c / 100).toFixed(2);
    const lines = [
      ['Order #', 'Ordered', 'Picked up', 'Customer', 'Item', 'Qty', 'Original unit price', 'Discount %', 'Unit price',
        'Food subtotal', 'Sales tax', 'Service fee', 'Total', 'Card', 'Status'],
      ...rep.orders.map((o) => [o.id, o.orderedTime, o.pickedUpTime, o.customer, o.item, o.quantity, d(o.originalUnitCents), o.discountPct,
        d(o.unitPriceCents), d(o.subtotalCents), d(o.taxCents), d(o.serviceFeeCents), d(o.totalCents), o.card, o.statusLabel]),
      [],
      ['Summary (picked-up orders)'],
      ['Orders picked up', rep.summary.ordersPickedUp],
      ['Meals rescued', rep.summary.mealsRescued],
      ['Menu value', d(rep.summary.menuValueCents)],
      ['Discounts given', d(rep.summary.discountsCents)],
      ['Food sales', d(rep.summary.foodSalesCents)],
      ['Sales tax collected', d(rep.summary.salesTaxCents)],
      ['BiteBack service fees (paid by customers)', d(rep.summary.serviceFeesCents)],
      ['Total charged to customers', d(rep.summary.totalChargedCents)],
      ['Awaiting pickup', rep.summary.awaitingPickup],
      ['Cancelled', rep.summary.cancelled],
      ['Not picked up', rep.summary.notPickedUp],
    ];
    return `${lines.map((l) => l.map(esc).join(',')).join('\n')}\n`;
  }

  function reportPdf(rep) {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40, info: { Title: `BiteBack daily report ${rep.date}`, Author: 'BiteBack' } });
    fonts(doc);
    const L = 40;
    const R = doc.page.width - 40;
    const W = R - L;
    doc.image(LOGO, L, 34, { height: 38 });
    doc.font('head').fontSize(18).fillColor(INK).text('Daily sales report', L, 36, { width: W, align: 'right' });
    doc.font('regular').fontSize(9.5).fillColor(MUTED).text(`${rep.restaurant.name} · ${rep.dateText}`, L, 60, { width: W, align: 'right' });
    doc.text(`${rep.restaurant.address}, ${rep.restaurant.city}, WA ${rep.restaurant.zip}${rep.restaurant.phone ? ` · ${rep.restaurant.phone}` : ''}`, L, 74, { width: W, align: 'right' });
    rule(doc, L, R, 96);

    const s = rep.summary;
    const cards = [
      ['Food sales', money(s.foodSalesCents)], ['Orders picked up', String(s.ordersPickedUp)], ['Meals rescued', String(s.mealsRescued)],
      ['Discounts given', money(s.discountsCents)], ['Sales tax', money(s.salesTaxCents)], ['Total charged', money(s.totalChargedCents)],
    ];
    const cw = (W - 5 * 8) / 6;
    cards.forEach(([k, v], i) => {
      const x = L + i * (cw + 8);
      doc.roundedRect(x, 108, cw, 50, 8).fill('#f2f7f4');
      label(doc, k.toUpperCase(), x + 10, 116, { width: cw - 16 });
      doc.font('head').fontSize(15).fillColor(i === 0 ? GREEN : INK).text(v, x + 10, 131, { width: cw - 16 });
    });
    doc.font('regular').fontSize(9).fillColor(MUTED).text(
      `Menu value ${money(s.menuValueCents)} · BiteBack service fees paid by customers ${money(s.serviceFeesCents)} · `
      + `Awaiting pickup ${s.awaitingPickup} · Cancelled ${s.cancelled} · Not picked up ${s.notPickedUp}`, L, 168, { width: W },
    );

    const cols = [
      ['#', 30, 'left'], ['Ordered', 52, 'left'], ['Picked up', 56, 'left'], ['Customer', 64, 'left'], ['Item', 128, 'left'], ['Qty', 28, 'right'],
      ['Original', 52, 'right'], ['Disc.', 36, 'right'], ['Price', 50, 'right'], ['Food', 54, 'right'], ['Tax', 46, 'right'], ['Total', 54, 'right'],
    ];
    cols.push(['Status', W - cols.reduce((n, c) => n + c[1], 0), 'left']);
    let y = 192;
    const header = () => {
      let x = L;
      doc.rect(L, y - 6, W, 20).fill('#0b1b14');
      cols.forEach(([h, w, a]) => {
        doc.font('bold').fontSize(8).fillColor('#ffffff').text(h.toUpperCase(), x + 3, y, { width: w - 6, align: a });
        x += w;
      });
      y += 20;
    };
    header();
    if (!rep.orders.length) doc.font('regular').fontSize(10).fillColor(MUTED).text('No orders on this day.', L, y + 6);
    rep.orders.forEach((o, i) => {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 40;
        header();
      }
      if (i % 2) doc.rect(L, y - 4, W, 18).fill('#f6f9f7');
      const vals = [String(o.id), o.orderedTime, o.pickedUpTime || '-', o.customer, o.item, String(o.quantity), money(o.originalUnitCents),
        `${o.discountPct}%`, money(o.unitPriceCents), money(o.subtotalCents), money(o.taxCents), money(o.totalCents), o.statusLabel];
      let x = L;
      cols.forEach(([, w, a], j) => {
        doc.font(j === 4 ? 'medium' : 'regular').fontSize(8.5).fillColor(o.status === 'picked_up' || j !== 12 ? INK : MUTED)
          .text(vals[j], x + 3, y, { width: w - 6, align: a, lineBreak: false, ellipsis: true });
        x += w;
      });
      y += 18;
    });
    doc.font('regular').fontSize(8).fillColor(MUTED).text(
      `Sales totals include orders picked up (and charged) on this day. Times in Pacific Time. Generated ${rep.generatedAtText}.`,
      L, doc.page.height - 50, { width: W, lineBreak: false },
    );
    return finish(doc);
  }

  return { receiptData, receiptPdf, reportData, reportCsv, reportPdf, todayIn: () => todayIn(timeZone) };
}

function fonts(doc) {
  doc.registerFont('regular', FONTS.regular);
  doc.registerFont('medium', FONTS.medium);
  doc.registerFont('bold', FONTS.bold);
  doc.registerFont('head', FONTS.head);
}

function label(doc, text, x, y, opts = {}) {
  doc.font('bold').fontSize(7.5).fillColor(MUTED).text(text, x, y, { characterSpacing: 0.8, ...opts });
}

function rule(doc, x1, x2, y) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(1).strokeColor(LINE).stroke();
}

function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { createReceiptService, dayRange };
