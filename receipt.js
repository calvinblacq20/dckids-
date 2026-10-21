/* DC Kids — customer receipt. The same document the admin prints (brand,
   amount, paid stamp, facts, items, total), shown to shoppers after checkout,
   after a Paystack payment, on the tracking page and in their account.

   DCReceipt.open({
     orderNumber, total, discountPercent, status, createdAt, orderType, paymentMethod, preorderKind,
     customerName, phone, email, address,
     items: [{ name, size, qty, price }]   // price is per piece; "Name (Size)" names are split
   });
*/
(function () {
  'use strict';

  const SHOP_PHONE = '+233 54 919 3805';
  const SETTLED = ['paid', 'completed', 'delivered', 'dispatched', 'shipped'];
  const KIND_LABELS = { bulk: 'Bulk pre-order', personal: 'Personal pre-order', shop: 'DC Kids pick (pre-order)' };
  let dialog = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => 'GH₵ ' + (Number(n) || 0).toFixed(2);
  // 233549193805 → +233 54 919 3805, the way the number is written everywhere else
  const formatPhone = (value) => {
    const d = String(value || '').replace(/\D/g, '');
    return /^233\d{9}$/.test(d) ? '+233 ' + d.slice(3, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8) : (value || SHOP_PHONE);
  };
  // SQLite timestamps come back as "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
  const toDate = (value) => {
    if (!value) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(value) ? String(value).replace(' ', 'T') + 'Z' : value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  function splitName(item) {
    if (item.size) return { name: item.name, size: item.size };
    const m = String(item.name || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    return m ? { name: m[1], size: m[2] } : { name: item.name || 'Item', size: 'Standard' };
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'receipt-dialog';
    dialog.setAttribute('aria-labelledby', 'dc-receipt-title');
    dialog.innerHTML =
      '<div class="receipt-dialog__bar">' +
        '<h2 id="dc-receipt-title">Your receipt</h2>' +
        '<button type="button" class="receipt-dialog__close" data-receipt="close">Close</button>' +
      '</div>' +
      '<div class="receipt" id="dc-receipt-card"></div>' +
      '<div class="receipt-dialog__actions">' +
        '<button type="button" class="btn" data-receipt="share">Share</button>' +
        '<button type="button" class="btn btn--dark" data-receipt="print" aria-label="Print or save as PDF">Print / PDF</button>' +
      '</div>' +
      '<p class="receipt-dialog__msg" role="status" aria-live="polite"></p>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (e) => {
      const action = e.target.closest('[data-receipt]');
      if (e.target === dialog || (action && action.dataset.receipt === 'close')) dialog.close();
      else if (action && action.dataset.receipt === 'print') print();
      else if (action && action.dataset.receipt === 'share') share();
    });
    window.addEventListener('afterprint', () => document.body.classList.remove('is-printing-receipt'));
  }

  function render(r) {
    const status = String(r.status || 'pending').toLowerCase();
    const settled = SETTLED.indexOf(status) >= 0;
    const when = toDate(r.createdAt) || new Date();
    const dateShort = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const dateLong = when.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const type = r.orderType === 'preorder' && KIND_LABELS[r.preorderKind] ? KIND_LABELS[r.preorderKind] : (r.orderType || 'retail');
    const contact = [r.phone, r.email, r.address].filter(Boolean).join(' · ') || '—';
    const rows = (r.items || []).map((item) => {
      const parts = splitName(item);
      const qty = Number(item.qty) || 1;
      return '<tr><td><span class="receipt__desc">' + esc(parts.name) + '</span><span class="receipt__size">Size: ' + esc(parts.size) + '</span></td>' +
        '<td class="num">' + qty + '</td><td class="num">' + money((Number(item.price) || 0) * qty) + '</td></tr>';
    }).join('');
    // The lines add up to the price before the discount; the total is what was charged.
    const discount = Number(r.discountPercent) || 0;
    const subtotal = (r.items || []).reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);
    const discountRows = discount > 0 && subtotal > 0
      ? '<div><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
        '<div><span>Discount (' + discount + '%)</span><span>&minus;' + money(subtotal - Number(r.total || 0)) + '</span></div>'
      : '';

    document.getElementById('dc-receipt-card').innerHTML =
      '<header class="receipt__id">' +
        '<img src="images/logo-mark.webp" alt="" class="receipt__logo" width="159" height="144">' +
        '<div><div class="receipt__brand">DC Kids Brand</div><div class="receipt__muted">Merging Style with Comfort</div>' +
        '<div class="receipt__muted">WhatsApp ' + esc(formatPhone(r.shopPhone)) + '</div></div>' +
      '</header>' +
      '<div class="receipt__headline"><div>' +
        '<div class="receipt__kicker">Official receipt</div>' +
        '<div class="receipt__amount">' + money(r.total) + '</div>' +
        '<div class="receipt__paidnote">' + (settled ? 'Payment in full · received with thanks' : 'Awaiting payment') + '</div>' +
      '</div>' +
      '<div class="receipt__stamp' + (settled ? ' is-settled' : '') + '"><b>' + esc(status.replace(/_/g, ' ')) + '</b><span>' + esc(dateShort) + '</span></div></div>' +
      '<dl class="receipt__facts">' +
        '<div><dt>Receipt no.</dt><dd class="receipt__mono">' + esc(r.orderNumber) + '</dd></div>' +
        '<div><dt>Date and time</dt><dd>' + esc(dateLong) + '</dd></div>' +
        '<div><dt>Order type</dt><dd>' + esc(type) + '</dd></div>' +
        '<div><dt>Payment method</dt><dd>' + esc(r.paymentMethod || 'WhatsApp') + '</dd></div>' +
        '<div><dt>Phone</dt><dd>' + esc(r.phone || '—') + '</dd></div>' +
        '<div><dt>Received by</dt><dd>DC Kids Brand</dd></div>' +
      '</dl>' +
      '<section class="receipt__from"><div class="receipt__kicker">Received from</div>' +
        '<div class="receipt__name">' + esc(r.customerName || '—') + '</div>' +
        '<div class="receipt__muted">' + esc(contact) + '</div></section>' +
      '<table class="receipt__table"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="3" class="receipt__muted">Item details are not available for this order.</td></tr>') + '</tbody></table>' +
      '<div class="receipt__sum">' + discountRows + '<div class="receipt__sum-total"><span>Order total</span><b>' + money(r.total) + '</b></div></div>' +
      '<p class="receipt__note">Thank you for shopping with DC Kids Brand.</p>';
  }

  function print() {
    document.body.classList.add('is-printing-receipt');
    window.print();
  }

  // Phones get the share sheet; desktops copy the text, which is what customers paste into WhatsApp.
  function share() {
    const msg = dialog.querySelector('.receipt-dialog__msg');
    const text = document.getElementById('dc-receipt-card').innerText.replace(/\n{3,}/g, '\n\n').trim();
    if (navigator.share) {
      navigator.share({ title: 'DC Kids Brand receipt', text: text }).catch(() => { /* dismissed */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => { msg.textContent = 'Receipt copied. Paste it wherever you need it.'; })
        .catch(() => { msg.textContent = 'Could not copy the receipt. Use Print instead.'; });
      return;
    }
    msg.textContent = 'Sharing is not available on this device. Use Print instead.';
  }

  window.DCReceipt = {
    open(receipt) {
      if (!dialog) build();
      dialog.querySelector('.receipt-dialog__msg').textContent = '';
      render(receipt || {});
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      dialog.querySelector('[data-receipt="close"]').focus();
    }
  };
})();
