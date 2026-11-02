/* The shop's WhatsApp number as set in admin. Pages that don't run the
   storefront script load this, so their WhatsApp and call links follow a
   change of number instead of keeping the one the page was written with.
   Scripts that build links later read window.DCShop.number (digits, country
   code first). */
(function () {
  'use strict';

  const WRITTEN = '233549193805';
  const shop = window.DCShop = { number: WRITTEN };
  // 233549193805 → +233 54 919 3805, the way the number is written on the pages
  const pretty = (d) => (/^233\d{9}$/.test(d) ? '+233 ' + d.slice(3, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8) : '+' + d);

  async function loadSettings() {
    // The static deploy has no API; settings.json carries the same public fields.
    for (const url of ['/api/settings', '/settings.json']) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) return await res.json();
      } catch (e) { /* unreachable: try the next source */ }
    }
    return {};
  }

  function repoint(digits) {
    document.querySelectorAll('a[href*="wa.me/' + WRITTEN + '"], a[href="tel:+' + WRITTEN + '"]').forEach((a) => {
      a.href = a.href.replace(WRITTEN, digits);
      if (a.textContent.includes(pretty(WRITTEN))) a.textContent = a.textContent.replace(pretty(WRITTEN), pretty(digits));
    });
  }

  shop.ready = loadSettings().then((settings) => {
    const digits = String(settings.whatsapp_number || '').replace(/\D/g, '');
    if (!/^\d{9,15}$/.test(digits) || digits === WRITTEN) return shop.number;
    shop.number = digits;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => repoint(digits));
    else repoint(digits);
    return digits;
  });
})();
