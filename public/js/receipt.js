import { api, $, esc, money, pct, renderHeader, requireRole, showError } from './common.js';

await requireRole('customer');
renderHeader('orders');

const id = Number(new URLSearchParams(location.search).get('order'));
$('#pdf-btn').href = `/api/orders/${id}/receipt.pdf`;
$('#print-btn').addEventListener('click', () => print());

try {
  const { receipt: r } = await api(`/orders/${id}/receipt`);
  document.title = `Receipt ${r.receiptNumber} · BiteBack`;
  const it = r.item;
  const rest = r.restaurant;
  $('#receipt').innerHTML = `
    <div class="p-head">
      <img src="/assets/logo.svg" alt="BiteBack">
      <div class="p-title"><h1>Receipt</h1><div class="p-muted small">${esc(r.receiptNumber)}</div></div>
    </div>
    <div class="p-cols">
      <div><div class="p-label">Restaurant</div><b>${esc(rest.name)}</b><div class="p-muted small">${esc(rest.address)}<br>${esc(rest.city)}, WA ${esc(rest.zip)}${rest.phone ? `<br>${esc(rest.phone)}` : ''}</div></div>
      <div><div class="p-label">Customer</div><b>${esc(r.customer.username)}</b><div class="p-muted small">${esc(r.customer.email)}</div></div>
    </div>
    <div class="p-facts">
      <div><div class="p-label">Order #</div><b>${r.orderId}</b></div>
      <div><div class="p-label">Ordered</div><b>${esc(r.orderedAtText)}</b></div>
      <div><div class="p-label">${r.status === 'picked_up' ? 'Picked up' : 'Pick up by'}</div><b>${esc(r.status === 'picked_up' ? r.pickedUpAtText : r.pickupByText)}</b></div>
      <div><div class="p-label">Status</div><b>${esc(r.statusLabel)}</b></div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th>Qty</th><th>Original</th><th>Discount</th><th>Price</th><th>Amount</th></tr></thead>
      <tbody><tr>
        <td><div class="item-cell">${it.imageUrl ? `<img src="${esc(it.imageUrl)}" alt="">` : ''}<b>${esc(it.title)}</b></div></td>
        <td>${it.quantity}</td>
        <td class="strike">${money(it.originalUnitCents)}</td>
        <td class="disc">-${it.discountPct}%</td>
        <td><b>${money(it.unitPriceCents)}</b></td>
        <td><b>${money(it.lineTotalCents)}</b></td>
      </tr></tbody>
    </table></div>
    <div class="save">You saved ${money(it.savingsCents)} (${it.discountPct}% off ${money(it.lineOriginalCents)}) and rescued ${it.quantity === 1 ? 'a meal' : `${it.quantity} meals`} from going to waste.</div>
    <table class="totals">
      <tr><td class="p-muted">Menu value</td><td class="p-muted">${money(it.lineOriginalCents)}</td></tr>
      <tr><td class="disc">Discount (${it.discountPct}%)</td><td class="disc">-${money(it.savingsCents)}</td></tr>
      <tr><td>Food subtotal</td><td>${money(r.subtotalCents)}</td></tr>
      <tr><td>Service fee (${r.serviceFeePct}%)</td><td>${money(r.serviceFeeCents)}</td></tr>
      <tr><td>WA sales tax (${pct(r.taxRateBps)})</td><td>${money(r.taxCents)}</td></tr>
      <tr class="grand"><td>Total</td><td>${money(r.totalCents)}</td></tr>
    </table>
    <div class="p-pay">
      <div><div class="p-label">Card</div><b>${esc(r.card || 'n/a')}</b></div>
      <div><div class="p-label">Payment status</div><b>${esc(r.paymentStatus)}</b></div>
      <div><div class="p-label">Amount charged</div><b>${money(r.amountChargedCents)}</b>${r.refundedCents ? `<div class="disc small">Refunded ${money(r.refundedCents)} on ${esc(r.refundedAtText)}</div>` : ''}</div>
      <div><div class="p-label">Transaction ID</div><b style="word-break:break-all">${esc(r.paymentRef || 'n/a')}</b></div>
    </div>
    ${r.pin ? `<div class="p-pin"><span>Pickup PIN: show at the counter</span><b>${esc(r.pin)}</b></div>` : ''}
    <p class="p-foot">Thank you for rescuing food with BiteBack! Your card is authorized when you order and charged only when the restaurant confirms pickup with your PIN.
      Orders not picked up are released without charge. Times shown in Pacific Time.</p>`;
} catch (err) {
  showError($('#msg'), err);
  $('#receipt').classList.add('hidden');
}
