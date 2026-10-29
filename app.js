/* DC Kids storefront — editorial layout over the live catalogue.
   Prices mirror POST /api/orders exactly; the server stays authoritative. */
'use strict';

const WA_DEFAULT = '233549193805';
const PAGE_SIZE = 12;
const SEARCH_LIMIT = 8;
const RETAIL_MAX_QTY = 100;
const WHOLESALE_MAX_QTY = 1000;
const CART_KEY = 'dcKidsCart';
const CUSTOMER_KEY = 'dcKidsCustomer';
const PAYSTACK_PENDING_KEY = 'dcKidsPendingPaystackCheckout';
const WISHLIST_KEY = 'dcKidsGuestWishlist'; // the same list product.html and the account page use
const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.4 3.5 4.3 6.7-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg>';
const WELCOME_KEY = 'dcKidsWelcome';                 // { phone, percent } once joined
const WELCOME_SNOOZE_KEY = 'dcKidsWelcomeSnoozed';   // when "No thanks" was pressed
const WELCOME_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const WELCOME_DELAY_MS = 12000;

const CAT_LABELS = {
  newborn: 'Newborn', clothing: 'Clothing', shoes: 'Shoes', footwear: 'Shoes',
  feeding: 'Feeding', gear: 'Baby gear', bathcare: 'Bath & care',
  essentials: 'Essentials', accessories: 'Accessories', bedding: 'Bedding',
  womens: "Women's fashion", home: 'Home', cars: 'Cars'
};
const CAT_ORDER = ['newborn', 'clothing', 'shoes', 'essentials', 'feeding', 'gear', 'bathcare', 'bedding', 'accessories', 'womens', 'home', 'cars'];

let products = [];
let catalogueLoaded = false;
let catalogueFromApi = false; // false on the static build, which has no /api to ask
let byId = new Map();
let siteConfig = {};
let storeMode = localStorage.getItem('storeMode') || 'retail';
let cart = [];
let wishlist = new Set();
let preorderView = false;
let checkoutIdemKey = null;
let checkoutIdemMethod = null;
let lastReceipt = null;
let revealObserver = null;
let pdpFromNav = false;
let paystackEnabled = false;
// Filled by firebase-auth.js (loaded async) through the dckids-auth-change event.
let customerState = { user: null, customer: null };
let savedAddresses = [];

const shop = { cat: 'all', q: '', shown: PAGE_SIZE };
const pdp = { id: null, size: null, qty: 1 };

/* ================================================================ helpers */
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function gh(n) { return (Number(n) || 0).toFixed(2); }
function waNumber() { return String(siteConfig.whatsapp_number || WA_DEFAULT).replace(/\D/g, '') || WA_DEFAULT; }
function waLink(text) { return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(text); }
function catKey(c) { return String(c || '').trim().toLowerCase(); }
function catLabel(c) {
  const k = catKey(c);
  return CAT_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Other');
}
const CATEGORY_TILES = ['clothing', 'shoes', 'accessories', 'feeding', 'gear', 'bathcare', 'newborn', 'bedding', 'essentials'];
function categoryTileImage(cat) {
  const key = catKey(cat);
  return CATEGORY_TILES.indexOf(key) === -1
    ? fallbackOf()
    : 'images/categories/' + key + '.webp';
}
function imgOf(p) { return window.DCImageResolver ? DCImageResolver.resolve(p).src : (p.img || 'images/placeholder.svg'); }
function fallbackOf() {
  const r = window.DCImageResolver;
  return r ? r.PLACEHOLDER : 'images/placeholder.svg';
}
function isWholesale() { return storeMode === 'wholesale' && !!siteConfig.wholesale_enabled; }
function moq() { return Math.max(1, parseInt(siteConfig.wholesale_moq, 10) || 10); }
function newIdemKey() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

/* ----------------------------------------------------------- pricing */
// Legacy per-age markup — must stay identical to the server's getPriceModifier.
function getPriceModifier(sizeLabel) {
  const s = String(sizeLabel || '').trim();
  if (/^(0-3M|3-6M|6-9M|9-12M|12-18M|0M|3M|6M|9M|12M|14|15|16|17|18|19|20|21)$/i.test(s)) return 0;
  if (/^(18M|24M|1Y|2Y|22|23|24|25|26|27)$/i.test(s)) return 5;
  if (/^(3Y|4Y|5Y|28|29|30|31|32)$/i.test(s)) return 10;
  if (/^(6Y|7Y|8Y|33|34|35|36)$/i.test(s)) return 15;
  return 0;
}

// Expand a legacy free-text size ("Size 25–35", "2Y – 8Y", "0 – 12M") into options.
function parseSize(str) {
  if (!str) return ['One Size'];
  let m = str.match(/Size\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (m) { const out = []; for (let i = +m[1]; i <= +m[2]; i++) out.push(String(i)); return out; }
  m = str.match(/(\d+)Y\s*[-–]\s*(\d+)Y/i);
  if (m) { const out = []; for (let i = +m[1]; i <= +m[2]; i++) out.push(i + 'Y'); return out; }
  m = str.match(/0\s*[-–]\s*(\d+)M/i);
  if (m) return parseInt(m[1], 10) <= 12 ? ['0-3M', '3-6M', '6-9M', '9-12M'] : ['0-3M', '3-6M', '6-9M', '9-12M', '12-18M'];
  m = str.match(/(\d+)M\s*[-–]\s*(\d+)M/i);
  if (m) { const s = +m[1], e = +m[2]; return [3, 6, 9, 12, 18, 24].filter((mo) => mo >= s && mo <= e).map((mo) => mo + 'M'); }
  return [str];
}

// Admin-managed per-size prices ([{label, price}]) win over the legacy scheme.
function getManagedSizes(p) {
  if (!p || !p.sizes) return null;
  try {
    const a = typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes;
    return (Array.isArray(a) && a.length) ? a : null;
  } catch (e) { return null; }
}
function sizesOf(p) {
  const managed = getManagedSizes(p);
  return managed ? managed.map((s) => s.label) : parseSize(p.size);
}

// Per-piece price for a size, computed the same way the server bills it.
function unitPrice(p, size) {
  const managed = getManagedSizes(p);
  const match = managed ? managed.find((s) => s.label === size) : null;
  const discount = isWholesale() ? Number(siteConfig.wholesale_discount || 0) : 0;
  let unit;
  if (match) {
    unit = (match.price != null ? Number(match.price) : Number(p.price || 0)) * (1 - discount / 100);
  } else {
    unit = Number(p.price || 0) * (1 - discount / 100) + getPriceModifier(size);
  }
  return Math.round(unit * 100) / 100;
}
function priceSpan(p) {
  const units = sizesOf(p).map((s) => unitPrice(p, s)).filter((v) => v > 0);
  if (!units.length) return null;
  return { min: Math.min(...units), max: Math.max(...units) };
}
function hasPrice(p) { return !!priceSpan(p); }
function priceLabel(p) {
  const span = priceSpan(p);
  if (!span) return p.fulfillment_type === 'preorder' ? 'Price on request' : 'Ask for price';
  // Non-breaking spaces keep "GH₵ 145.00" whole; a narrow card may wrap a range at its dash.
  const per = isWholesale() ? ' / pc' : '';
  return (span.max - span.min > 0.005 ? 'GH₵ ' + gh(span.min) + ' – ' + gh(span.max) : 'GH₵ ' + gh(span.min)) + per;
}
// A sale needs a real was-price above today's price. Wholesale has its own
// pricing, so the retail sale is not shown there.
function salePercent(p) {
  const was = Number(p.compare_at_price);
  const now = Number(p.price);
  if (isWholesale() || !(now > 0) || !(was > now)) return 0;
  return Math.round((1 - now / was) * 100);
}
// What a price was before the sale: the same proportion above it.
function wasPrice(p, amount) { return Math.round(amount * Number(p.compare_at_price) / Number(p.price) * 100) / 100; }
function salePriceHTML(p, amount, prefix) {
  return '<span class="price-now">' + prefix + 'GH₵ ' + gh(amount) + '</span>' +
    '<s class="price-was"><span class="sr-only">was </span>GH₵ ' + gh(wasPrice(p, amount)) + '</s>';
}
function isSoldOut(p) { return p.stock === 0; }
function isPreorder(p) { return p.fulfillment_type === 'preorder'; }
function maxQtyFor(p) {
  const cap = isWholesale() ? WHOLESALE_MAX_QTY : RETAIL_MAX_QTY;
  return (!isPreorder(p) && typeof p.stock === 'number' && p.stock > 0) ? Math.min(cap, p.stock) : cap;
}

/* ============================================================ rendering */
function statusBadge(p) {
  const b = String(p.badge || '').trim();
  const key = b.toLowerCase();
  if (isPreorder(p) || key === 'china' || key === 'preorder') return '<span class="card__badge">Pre-order</span>';
  if (b) return '<span class="card__badge">' + esc(key === 'hot' ? 'Hot' : key === 'new' ? 'New' : b) + '</span>';
  if (typeof p.stock === 'number' && p.stock > 0 && p.stock <= 5) return '<span class="card__badge card__badge--soft">Only ' + p.stock + ' left</span>';
  return '';
}
function badgeHTML(p) {
  if (isSoldOut(p)) return '<span class="card__soldout">Sold out</span>';
  const off = salePercent(p);
  const badges = (off ? '<span class="card__badge card__badge--sale">' + off + '% off</span>' : '') + statusBadge(p);
  return badges ? '<span class="card__badges">' + badges + '</span>' : '';
}

function cardPriceHTML(p) {
  const span = salePercent(p) ? priceSpan(p) : null;
  if (!span) return '<span class="card__price">' + esc(priceLabel(p)) + '</span>';
  return '<span class="card__price card__price--sale">' + salePriceHTML(p, span.min, span.max - span.min > 0.005 ? 'From ' : '') + '</span>';
}

// The heart sits beside the card link, not inside it: a button nested in a
// link is invalid and would open the product as well as saving it.
function cardHTML(p, i, life) {
  const delay = (i % 3) * 70;
  const saved = wishlist.has(p.id);
  return '<div class="card-cell reveal-card" style="transition-delay:' + delay + 'ms">' +
      '<a class="card' + (life ? ' card--life' : '') + '" href="#product-' + p.id + '">' +
        '<span class="card__media">' +
          '<img src="' + esc(imgOf(p)) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + esc(fallbackOf()) + '\'">' +
          badgeHTML(p) +
        '</span>' +
        '<span class="card__body">' +
          '<span class="card__name">' + esc(p.name) + '</span>' +
          cardPriceHTML(p) +
        '</span>' +
      '</a>' +
      '<button type="button" class="card__save' + (saved ? ' is-on' : '') + '" data-save="' + p.id + '" aria-pressed="' + saved + '" aria-label="Save ' + esc(p.name) + ' to your wishlist">' + HEART_SVG + '</button>' +
    '</div>';
}

function skeletonHTML(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += '<div class="card card--skel" aria-hidden="true"><span class="card__media"></span><span class="card__body"><span class="sk-line"></span><span class="sk-line sk-line--short"></span></span></div>';
  return out;
}

// Full-bleed collection tile. Product photos vary too much (posters, collages)
// to carry overlaid text, so the editorial slots use the styled category shots.
function editorialTileHTML(cat, i) {
  return '<a class="card card--life card--edit reveal-card" href="#shop" data-cat="' + esc(cat) + '" style="transition-delay:' + ((i % 3) * 70) + 'ms">' +
      '<span class="card__media"><img src="' + esc(categoryTileImage(cat)) + '" alt="' + esc(catLabel(cat)) + ' collection" loading="lazy" decoding="async"></span>' +
      '<span class="card__body"><span class="card__name">' + esc(catLabel(cat)) + '</span><span class="card__price">Shop now &rarr;</span></span>' +
    '</a>';
}

function renderBestsellers() {
  const el = $('bestsellers-grid');
  if (!el) return;
  const isReal = (p) => !!(window.DCImageResolver && DCImageResolver.isGenuineImage(p.img));
  const rank = (p) => (catKey(p.badge) === 'hot' ? 0 : 4) + (isReal(p) ? 0 : 2) + (isSoldOut(p) ? 8 : 0);
  const seen = new Set();
  const picks = products.filter((p) => hasPrice(p) && inStockView(p)).slice().sort((a, b) => rank(a) - rank(b))
    .filter((p) => { const k = String(p.name).trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 4);

  // Biggest collections, skipping the ones already pictured in hero / new-in / about.
  const counts = categoryCounts();
  const usedAbove = ['clothing', 'newborn', 'essentials'];
  const tiles = Object.keys(counts).filter((c) => usedAbove.indexOf(c) === -1).sort((a, b) => counts[b] - counts[a]).slice(0, 2);

  // Editorial rhythm: lifestyle tiles on a diagonal.
  const cells = picks.map((p, i) => cardHTML(p, i + 1, false));
  if (tiles[0]) cells.unshift(editorialTileHTML(tiles[0], 0));
  if (tiles[1]) cells.push(editorialTileHTML(tiles[1], 5));
  el.innerHTML = cells.join('');
  observeReveals(el);
}


// China pre-orders have their own tab: the shop grids, categories, bestsellers
// and search all leave pre-order pieces out.
function inStockView(p) { return !isPreorder(p); }
function categoryCounts() {
  const counts = {};
  products.filter(inStockView).forEach((p) => { const k = catKey(p.cat); if (k) counts[k] = (counts[k] || 0) + 1; });
  return counts;
}
function orderedCats(counts) {
  const pos = (c) => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };
  return Object.keys(counts).sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
}

function renderCollections() {
  const el = $('collections-list');
  if (!el) return;
  const counts = categoryCounts();
  el.innerHTML = orderedCats(counts).map((c) =>
    '<a class="coll" href="#shop" data-cat="' + esc(c) + '" data-img="' + esc(categoryTileImage(c)) + '">' +
      '<span>' + esc(catLabel(c)) + '</span>' +
      '<span class="coll__idx">' + counts[c] + ' item' + (counts[c] === 1 ? '' : 's') + '</span>' +
    '</a>'
  ).join('');
  observeReveals(el.parentElement);
}

function renderShopCats() {
  const el = $('shop-cats');
  if (!el) return;
  const cats = orderedCats(categoryCounts());
  el.innerHTML = ['all'].concat(cats).map((c) =>
    '<button type="button" class="cat-chip' + (shop.cat === c ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-pressed="' + (shop.cat === c) + '">' +
      esc(c === 'all' ? 'All' : catLabel(c)) +
    '</button>'
  ).join('');
}

// Every word must appear somewhere, so "girls dress" finds "Dress for girls".
function matchesQuery(p, q) {
  const hay = [p.name, p.cat, catLabel(p.cat), p.sku, p.description].map((v) => String(v || '')).join(' ').toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

function filteredProducts() {
  const q = shop.q.trim().toLowerCase();
  return products.filter((p) =>
    inStockView(p) && (shop.cat === 'all' || catKey(p.cat) === shop.cat) && (!q || matchesQuery(p, q))
  );
}

function renderShop() {
  const grid = $('product-grid');
  if (!grid) return;
  const list = filteredProducts();
  if (!list.length) {
    grid.innerHTML = '<div class="shop-empty">No products match' + (shop.q ? ' “' + esc(shop.q) + '”' : ' this category') +
      '. <a href="#shop" class="link-underline" onclick="resetShop();return false;">Show everything</a></div>';
    $('shop-more').innerHTML = '';
    return;
  }
  grid.innerHTML = list.slice(0, shop.shown).map((p, i) => cardHTML(p, i, false)).join('');
  renderShopMore(list.length);
  observeReveals(grid);
}
function renderShopMore(total) {
  const left = total - shop.shown;
  $('shop-more').innerHTML = left > 0
    ? '<button class="btn" type="button" onclick="loadMore()">Load more (' + left + ')</button>'
    : '';
}
function loadMore() {
  const list = filteredProducts();
  const start = shop.shown;
  shop.shown += PAGE_SIZE;
  $('product-grid').insertAdjacentHTML('beforeend', list.slice(start, shop.shown).map((p, i) => cardHTML(p, i, false)).join(''));
  renderShopMore(list.length);
  observeReveals($('product-grid'));
}
function setShopCat(cat) {
  shop.cat = cat;
  shop.shown = PAGE_SIZE;
  renderShopCats();
  renderShop();
}
function resetShop() {
  shop.q = '';
  const input = $('shop-search');
  if (input) input.value = '';
  setShopCat('all');
}

/* ================================================================ reveals */
function observeReveals(root) {
  const scope = root || document;
  const els = scope.querySelectorAll('.reveal, .reveal-img, .reveal-img--diag, .reveal-stagger, .reveal-card');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  }
  els.forEach((e) => { if (!e.classList.contains('in')) revealObserver.observe(e); });
}

/* =================================================================== cart */
function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    cart = Array.isArray(raw)
      ? raw.map((i) => ({ id: Number(i.id), size: i.size, qty: Math.max(1, parseInt(i.qty, 10) || 1) })).filter((i) => i.id)
      : [];
  } catch (e) { cart = []; }
}
function saveCart() {
  // name/price/img are a snapshot for display only — prices are recomputed live.
  localStorage.setItem(CART_KEY, JSON.stringify(cart.map((i) => {
    const p = byId.get(i.id) || {};
    return { id: i.id, size: i.size, qty: i.qty, name: p.name, price: p.name ? unitPrice(p, i.size) : 0, img: p.img };
  })));
}
function cartSubtotal() {
  return cart.reduce((sum, i) => { const p = byId.get(i.id); return p ? sum + unitPrice(p, i.size) * i.qty : sum; }, 0);
}
function cartCount() { return cart.reduce((n, i) => n + i.qty, 0); }

function addToCart(id, size, qty) {
  const p = byId.get(id);
  if (!p) return false;
  const line = cart.find((i) => i.id === id && i.size === size);
  const max = maxQtyFor(p);
  if (line) line.qty = Math.min(max, line.qty + qty);
  else cart.push({ id: id, size: size, qty: Math.min(max, qty) });
  saveCart();
  renderCart();
  return true;
}
function cartLineQty(index, dir) {
  const line = cart[index];
  if (!line) return;
  const p = byId.get(line.id);
  const step = isWholesale() ? moq() : 1;
  const next = line.qty + dir * step;
  if (next < step) cart.splice(index, 1);
  else line.qty = Math.min(p ? maxQtyFor(p) : next, next);
  saveCart();
  renderCart();
}
function removeLine(index) { cart.splice(index, 1); saveCart(); renderCart(); }

function renderCart() {
  const count = cartCount();
  $('cart-count').textContent = count;
  syncDrawerTitle();
  const itemsEl = $('cart-items');
  if (!cart.length) {
    itemsEl.innerHTML = '<div class="cart__empty">Your cart is empty.<br><a href="#shop" class="link-underline" onclick="closeCart()" style="margin-top:14px">Start shopping</a></div>';
  } else {
    const hasPre = cart.some((i) => { const p = byId.get(i.id); return p && isPreorder(p); });
    itemsEl.innerHTML = cart.map((i, idx) => {
      const p = byId.get(i.id);
      if (!p) return '';
      return '<div class="citem">' +
          '<img class="citem__img" src="' + esc(imgOf(p)) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(fallbackOf()) + '\'">' +
          '<div>' +
            '<div class="citem__name">' + esc(p.name) + '</div>' +
            '<div class="citem__meta">Size ' + esc(i.size) + ' · GH₵ ' + gh(unitPrice(p, i.size)) + (isWholesale() ? ' / pc' : '') + '</div>' +
            '<div class="citem__qty"><button type="button" onclick="cartLineQty(' + idx + ',-1)" aria-label="Decrease">&minus;</button><span>' + i.qty + '</span><button type="button" onclick="cartLineQty(' + idx + ',1)" aria-label="Increase">+</button></div>' +
            '<div><button class="citem__rm" type="button" onclick="removeLine(' + idx + ')">Remove</button></div>' +
          '</div>' +
          '<div class="citem__price">GH₵ ' + gh(unitPrice(p, i.size) * i.qty) + '</div>' +
        '</div>';
    }).join('') + (hasPre ? '<p class="cart__hint">Includes China pre-order items. These are paid in full before we order them.</p>' : '');
  }
  $('cart-subtotal').textContent = 'GH₵ ' + gh(cartSubtotal());
  renderCheckoutTotal();
  $('checkout-btn').disabled = !cart.length;
}

/* ============================================================== overlays */
function syncScrollLock() {
  const open = ['cart', 'pdp', 'm-menu', 'search'].some((id) => $(id).classList.contains('open'));
  document.documentElement.style.overflow = open ? 'hidden' : '';
}
// The nav "Cart" button always lands on the item list; checkout passes 'details'.
function openCart(view) {
  showCartView(typeof view === 'string' ? view : 'items');
  $('cart').classList.add('open');
  $('cart').setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('show');
  syncScrollLock();
}
function closeCart() {
  $('cart').classList.remove('open');
  $('cart').setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('show');
  syncScrollLock();
}
function showCartView(view) {
  ['items', 'details', 'saved', 'done'].forEach((k) => { $('cart-view-' + k).hidden = k !== view; });
  syncDrawerTitle();
}
// The drawer holds the cart and the wishlist; its heading follows the view.
function syncDrawerTitle() {
  const onSaved = !$('cart-view-saved').hidden;
  $('cart-title-text').textContent = onSaved ? 'Your wishlist' : 'Your cart';
  $('cart-count-head').textContent = onSaved ? savedProducts().length : cartCount();
}

/* =============================================================== wishlist */
// Guests keep the list in the browser; signed-in shoppers keep it on their
// account, where it merges with what they saved as a guest.
function readGuestWishlist() {
  try {
    const ids = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
    return new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger));
  } catch (e) { return new Set(); }
}
// Saved pieces still in the catalogue; a removed product just drops out.
function savedProducts() { return Array.from(wishlist).map((id) => byId.get(id)).filter(Boolean); }

async function syncWishlist() {
  if (!isSignedIn()) { wishlist = readGuestWishlist(); paintWishlist(); return; }
  try {
    const guestIds = Array.from(readGuestWishlist());
    if (guestIds.length) {
      const merge = await fetch('/api/wishlist/merge', { method: 'POST', headers: await customerAuthHeaders(), body: JSON.stringify({ productIds: guestIds }) });
      if (merge.ok) localStorage.removeItem(WISHLIST_KEY);
    }
    const res = await fetch('/api/wishlist', { headers: await customerAuthHeaders(), cache: 'no-store' });
    if (res.ok) wishlist = new Set((await res.json()).map((row) => Number(row.product_id)));
  } catch (e) {
    console.warn('[Wishlist] using this device\'s copy:', e.message);
    wishlist = readGuestWishlist();
  }
  paintWishlist();
}

async function toggleWishlist(id) {
  const p = byId.get(Number(id));
  if (!p) return;
  const wasSaved = wishlist.has(p.id);
  if (wasSaved) wishlist.delete(p.id); else wishlist.add(p.id);
  paintWishlist();
  try {
    if (isSignedIn()) {
      const res = await fetch(wasSaved ? '/api/wishlist/' + p.id : '/api/wishlist', {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: await customerAuthHeaders(),
        body: wasSaved ? undefined : JSON.stringify({ product_id: p.id })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } else {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(Array.from(wishlist)));
    }
    toast(wasSaved ? 'Removed from your wishlist' : 'Saved to your wishlist');
  } catch (e) {
    if (wasSaved) wishlist.add(p.id); else wishlist.delete(p.id);
    paintWishlist();
    toast('Could not update your wishlist. Please try again.');
  }
}

function paintWishlist() {
  document.querySelectorAll('[data-save]').forEach((btn) => {
    const on = wishlist.has(Number(btn.dataset.save));
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const count = savedProducts().length;
  $('saved-count').textContent = count;
  $('m-saved-count').textContent = count ? '(' + count + ')' : '';
  const pdpSaved = wishlist.has(pdp.id);
  $('pdp-save').classList.toggle('is-on', pdpSaved);
  $('pdp-save').setAttribute('aria-pressed', String(pdpSaved));
  $('pdp-save-label').textContent = pdpSaved ? 'Saved to wishlist' : 'Save to wishlist';
  if (!$('cart-view-saved').hidden) renderSaved();
  syncDrawerTitle();
}

function renderSaved() {
  const items = savedProducts();
  $('saved-items').innerHTML = items.length
    ? items.map((p) =>
        '<div class="citem">' +
          '<img class="citem__img" src="' + esc(imgOf(p)) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(fallbackOf()) + '\'">' +
          '<div>' +
            '<div class="citem__name">' + esc(p.name) + '</div>' +
            '<div class="citem__meta">' + (isSoldOut(p) ? 'Sold out' : esc(priceLabel(p))) + '</div>' +
            '<div class="citem__links"><a class="link-underline" href="#product-' + p.id + '" onclick="closeCart()">Choose a size</a>' +
            '<button class="citem__rm" type="button" data-unsave="' + p.id + '">Remove</button></div>' +
          '</div>' +
        '</div>'
      ).join('')
    : '<div class="cart__empty">Nothing saved yet.<br>Tap the heart on any piece to keep it here.<br><a href="#shop" class="link-underline" onclick="closeCart()" style="margin-top:14px">Browse the shop</a></div>';
}
function openSaved() {
  renderSaved();
  openCart('saved');
}
function toggleMenu(open) {
  $('m-menu').classList.toggle('open', open);
  $('m-menu').setAttribute('aria-hidden', String(!open));
  syncScrollLock();
}
function closeAll() {
  if ($('pdp').classList.contains('open')) closePdp();
  closeCart();
  toggleMenu(false);
  closeSearch();
}

/* ================================================================= search */
function openSearch() {
  closeAll();
  const el = $('search');
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  $('search-btn').setAttribute('aria-expanded', 'true');
  syncScrollLock();
  renderSearch();
  const input = $('search-input');
  input.focus();
  input.select();
}
// restoreFocus=false when the shopper is moving on (opening a product, jumping to the shop).
function closeSearch(restoreFocus) {
  const el = $('search');
  if (!el.classList.contains('open')) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  $('search-btn').setAttribute('aria-expanded', 'false');
  syncScrollLock();
  if (restoreFocus !== false) $('search-btn').focus();
}

function renderSearch() {
  const raw = $('search-input').value.trim();
  const q = raw.toLowerCase();
  const status = $('search-status');
  const grid = $('search-results');
  const more = $('search-more');
  const suggest = $('search-suggest');
  grid.innerHTML = '';
  more.innerHTML = '';
  suggest.innerHTML = '';

  if (!catalogueLoaded) { status.textContent = 'Loading the catalogue…'; return; }
  if (!products.length) { status.textContent = 'We couldn\'t load the catalogue right now. Please try again shortly.'; return; }
  if (!q) {
    status.textContent = 'Popular collections';
    suggest.innerHTML = orderedCats(categoryCounts()).slice(0, 8).map((c) =>
      '<button type="button" class="search__chip" data-q="' + esc(catLabel(c)) + '">' + esc(catLabel(c)) + '</button>'
    ).join('');
    return;
  }

  // Name matches first; the rest (category / description hits) after.
  const nameHit = (p) => (String(p.name).toLowerCase().includes(q) ? 0 : 1);
  const hits = products.filter((p) => inStockView(p) && matchesQuery(p, q)).sort((a, b) => nameHit(a) - nameHit(b));
  if (!hits.length) {
    status.textContent = 'No products match “' + raw + '”.';
    more.innerHTML = '<a class="link-underline" href="' + esc(waLink('Hello DC Kids! Do you have ' + raw + '?')) + '" target="_blank" rel="noopener">Ask us to source it on WhatsApp</a>';
    return;
  }
  status.textContent = hits.length + (hits.length === 1 ? ' result' : ' results') + ' for “' + raw + '”';
  grid.innerHTML = hits.slice(0, SEARCH_LIMIT).map((p, i) => cardHTML(p, i, false)).join('');
  if (hits.length > SEARCH_LIMIT) {
    more.innerHTML = '<button class="btn" type="button" onclick="viewAllResults()">View all ' + hits.length + ' in the shop</button>';
  }
}

// Hands the query to the Shop section so the full list pages like any other browse.
function viewAllResults() {
  const q = $('search-input').value.trim();
  if (!q || !products.some((p) => matchesQuery(p, q.toLowerCase()))) return;
  shop.q = q;
  shop.cat = 'all';
  shop.shown = PAGE_SIZE;
  if ($('shop-search')) $('shop-search').value = q;
  renderShopCats();
  renderShop();
  closeSearch(false);
  $('shop').scrollIntoView();
}

/* ==================================================================== PDP */
function productImages(p) {
  const list = [imgOf(p)];
  if (Array.isArray(p.images)) {
    p.images.forEach((x) => {
      const url = typeof x === 'string' ? x : (x && (x.url || x.path || x.image_url));
      if (url && list.indexOf(url) === -1) list.push(url);
    });
  }
  return list;
}

function paintPdpThumbs(p) {
  const imgs = productImages(p);
  $('pdp-thumbs').innerHTML = imgs.length > 1
    ? imgs.map((src, i) => '<img src="' + esc(src) + '" alt="' + esc(p.name) + ', photo ' + (i + 1) + '" loading="lazy" onclick="document.getElementById(\'pdp-img\').src=this.src">').join('')
    : '';
}

// The live catalogue list carries no galleries, so the first time a product
// opens its photos come from its own endpoint. (The static build's
// products.json lists them already.)
function loadPdpGallery(p) {
  p.images = [];
  fetch('/api/products/' + p.id)
    .then((res) => (res.ok && /json/.test(res.headers.get('content-type') || '') ? res.json() : null))
    .then((full) => {
      if (!full || !Array.isArray(full.images)) return;
      p.images = full.images;
      if (pdp.id === p.id) paintPdpThumbs(p);
    })
    .catch(() => { /* offline: the main photo is already showing */ });
}

function openPdp(id) {
  const p = byId.get(Number(id));
  if (!p) return;
  const sizes = sizesOf(p);
  pdp.id = p.id;
  pdp.size = sizes[0];
  pdp.qty = isWholesale() ? moq() : 1;

  const img = $('pdp-img');
  img.onerror = function () { this.onerror = null; this.src = fallbackOf(); };
  img.src = imgOf(p);
  img.alt = p.name;
  $('pdp-name').textContent = p.name;
  $('pdp-desc').textContent = p.description || '';
  $('pdp-desc').hidden = !p.description;

  paintPdpThumbs(p);
  if (catalogueFromApi && !Array.isArray(p.images)) loadPdpGallery(p);

  $('pdp-sizes').innerHTML = sizes.map((s) =>
    '<button type="button" class="size-chip' + (s === pdp.size ? ' sel' : '') + '" role="radio" aria-checked="' + (s === pdp.size) + '" data-size="' + esc(s) + '">' + esc(s) + '</button>'
  ).join('');

  const ref = p.name + (p.sku ? ' (' + p.sku + ')' : '');
  $('pdp-ask').href = waLink(isPreorder(p)
    ? 'Hi DC Sourcing & Logistics! I\'d like to pre-order ' + ref + '. ' + (hasPrice(p) ? 'Is it still available?' : 'What is the price?')
    : 'Hello DC Kids! I\'m interested in ' + ref + '.');
  $('pdp-more').href = '/product.html?id=' + p.id;
  updatePdp();
  paintWishlist();

  const el = $('pdp');
  el.scrollTop = 0;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  syncScrollLock();
  syncChrome(); // the PDP sits under the nav, so the nav must be the solid bar
}

function updatePdp() {
  const p = byId.get(pdp.id);
  if (!p) return;
  const priced = hasPrice(p);
  const off = priced ? salePercent(p) : 0;
  $('pdp-price').classList.toggle('is-sale', !!off);
  if (off) {
    $('pdp-price').innerHTML = salePriceHTML(p, unitPrice(p, pdp.size), '') + '<span class="price-off">' + off + '% off</span>';
  } else {
    $('pdp-price').textContent = priced
      ? 'GH₵ ' + gh(unitPrice(p, pdp.size)) + (isWholesale() ? ' / pc' : '')
      : (isPreorder(p) ? 'Price on request' : '');
  }

  let stock = '';
  if (isSoldOut(p)) stock = 'Sold out';
  else if (isPreorder(p)) stock = 'China pre-order · paid in full up front · arrives in 3–4 weeks';
  else if (typeof p.stock === 'number' && p.stock <= 5) stock = 'Only ' + p.stock + ' left';
  else if (typeof p.stock === 'number') stock = p.stock + ' in stock';
  if (isWholesale() && !isSoldOut(p)) stock += (stock ? ' · ' : '') + 'Minimum ' + moq() + ' pieces';
  $('pdp-stock').textContent = stock;
  $('pdp-qty').textContent = pdp.qty;

  const blocked = isSoldOut(p) || !priced || (isWholesale() && maxQtyFor(p) < moq());
  $('pdp-add').disabled = blocked;
  $('pdp-buy').disabled = blocked;
  $('pdp-buy').textContent = priced ? 'Buy Now' : 'Ask for price';
  $('pdp-buy').disabled = isSoldOut(p) || (isWholesale() && maxQtyFor(p) < moq());
  $('pdp-buy').dataset.ask = priced ? '' : '1';
  $('pdp-sizes').querySelectorAll('.size-chip').forEach((b) => {
    const on = b.dataset.size === pdp.size;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function pdpQty(dir) {
  const p = byId.get(pdp.id);
  if (!p) return;
  const step = isWholesale() ? moq() : 1;
  pdp.qty = Math.max(step, Math.min(maxQtyFor(p), pdp.qty + dir * step));
  updatePdp();
}

function pdpAdd(buyNow) {
  const p = byId.get(pdp.id);
  if (!p) return;
  if (buyNow && $('pdp-buy').dataset.ask) {
    window.open($('pdp-ask').href, '_blank', 'noopener');
    return;
  }
  if (!addToCart(p.id, pdp.size, pdp.qty)) return;
  closePdp();
  if (buyNow) {
    startCheckout();
  } else {
    toast('Added to cart — ' + p.name);
    openCart();
  }
}

function closePdpUI() {
  const el = $('pdp');
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  syncScrollLock();
  syncChrome();
}
function closePdp() {
  if (pdpFromNav && /^#product-\d+$/.test(location.hash)) {
    pdpFromNav = false;
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    closePdpUI();
  }
}
function onHashChange() {
  // Links to #preorders (nav, menu, footer, the announcement) open the China Pre-Order tab.
  if (location.hash === '#preorders') { showPreorders(true); return; }
  const m = location.hash.match(/^#product-(\d+)$/);
  if (m) openPdp(m[1]);
  else if ($('pdp').classList.contains('open')) closePdpUI();
}

/* ============================================================== checkout */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fillIfEmpty(id, value) { if (value && !$(id).value) $(id).value = value; }
function fillAddress(a) {
  $('co-line1').value = a.address_line1 || '';
  $('co-line2').value = a.address_line2 || '';
  $('co-city').value = a.city || '';
  $('co-region').value = a.region || '';
  fillIfEmpty('co-name', a.recipient_name);
  fillIfEmpty('co-phone', a.phone);
}
function renderSavedAddresses(selected) {
  $('co-saved-wrap').hidden = !savedAddresses.length;
  $('co-saved').innerHTML = '<option value="">Enter a different address</option>' + savedAddresses.map((a) =>
    '<option value="' + Number(a.id) + '">' + esc(a.label || 'Saved address') + ' · ' + esc([a.address_line1, a.city].filter(Boolean).join(', ')) + '</option>'
  ).join('');
  $('co-saved').value = selected ? String(selected.id) : '';
}

function startCheckout() {
  if (!cart.length) { toast('Your cart is empty'); return; }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || '{}') || {}; } catch (e) { /* no saved details — fine */ }
  const account = customerState.customer || {};
  // A number with an unused welcome offer comes first, or the discount would silently not apply.
  const joined = readWelcome();
  const welcomePhone = joined && joined.percent > 0 ? joined.phone : '';
  fillIfEmpty('co-name', account.name || saved.name);
  fillIfEmpty('co-phone', welcomePhone || account.phone || saved.phone);
  fillIfEmpty('co-email', account.email || (customerState.user && customerState.user.email) || saved.email);
  // Signed in, the server charges the account's verified email whatever is typed here.
  $('co-email').readOnly = isSignedIn();

  const preferred = savedAddresses.find((a) => a.is_default) || savedAddresses[0] || null;
  renderSavedAddresses(preferred);
  if (preferred && !$('co-line1').value) fillAddress(preferred);
  else {
    fillIfEmpty('co-line1', saved.line1);
    fillIfEmpty('co-city', saved.city || saved.area);
    fillIfEmpty('co-region', saved.region);
  }

  $('co-error').hidden = true;
  $('pay-btn').hidden = !paystackEnabled;
  $('co-pay-note').hidden = !paystackEnabled;
  $('co-hint').textContent = paystackEnabled
    ? 'Pay online with Paystack, or finish your order on WhatsApp.'
    : 'Your order completes on WhatsApp. We\'ll confirm delivery and payment there.';
  renderCheckoutTotal();
  openCart('details');
  setTimeout(() => $(!$('co-name').value ? 'co-name' : !$('co-phone').value ? 'co-phone' : 'co-name').focus(), 450);
}

function fieldError(id, bad) { $(id).closest('.field').classList.toggle('err', bad); }

async function submitOrder(e) {
  e.preventDefault();
  const method = (e.submitter && e.submitter.value) || 'whatsapp';
  const online = method === 'paystack';
  const val = (id) => $(id).value.trim();
  const name = val('co-name');
  const phone = val('co-phone');
  const email = val('co-email');
  const notes = val('co-notes');
  const address = { line1: val('co-line1'), line2: val('co-line2'), city: val('co-city'), region: val('co-region'), landmark: val('co-landmark') };

  // Paystack needs a receipt email and a full address; WhatsApp only needs a way to reach you.
  const checks = [
    ['co-name', name.length < 2, 'Please enter your full name.'],
    ['co-phone', phone.replace(/\D/g, '').length < 9, 'Please enter your phone or WhatsApp number.'],
    ['co-email', (online || !!email) && !EMAIL_RE.test(email), online ? 'Enter a valid email address to pay with Paystack.' : 'Please check your email address.'],
    ['co-line1', online && !address.line1, 'Please enter your delivery address to pay with Paystack.'],
    ['co-city', online && !address.city, 'Please enter your city or area to pay with Paystack.'],
    ['co-region', online && !address.region, 'Please enter your region to pay with Paystack.']
  ];
  checks.forEach((c) => fieldError(c[0], c[1]));
  const firstBad = checks.find((c) => c[1]);
  $('co-error').textContent = firstBad ? firstBad[2] : '';
  $('co-error').hidden = !firstBad;
  // Take the shopper straight back to the first missing detail.
  if (firstBad) { $(firstBad[0]).focus(); return false; }
  if (!cart.length) { toast('Your cart is empty'); return false; }

  const hasPre = cart.some((i) => { const p = byId.get(i.id); return p && isPreorder(p); });
  const orderType = hasPre ? 'preorder' : (isWholesale() ? 'wholesale' : 'retail');
  // Pre-orders placed from the shop are the DC Kids picks, or bulk when bought at wholesale;
  // personal pre-orders are custom requests that start on WhatsApp.
  const preorderKind = hasPre ? (isWholesale() ? 'bulk' : 'shop') : null;
  const lines = cart.map((i) => { const p = byId.get(i.id); return { name: p.name, size: i.size, qty: i.qty, price: unitPrice(p, i.size) }; });
  const where = [address.line1, address.line2, address.city, address.region].filter(Boolean).join(', ');
  const receipt = {
    orderType: orderType, preorderKind: preorderKind, customerName: name, phone: phone, email: email,
    address: where, items: lines, shopPhone: waNumber(), createdAt: new Date().toISOString()
  };

  // A failed Paystack start must not be replayed as the WhatsApp order, so each method keeps its own key.
  if (!checkoutIdemKey || checkoutIdemMethod !== method) { checkoutIdemKey = newIdemKey(); checkoutIdemMethod = method; }
  const payload = {
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    order_type: orderType,
    preorder_kind: preorderKind,
    delivery_area: address.city,
    delivery_address: address,
    notes: notes,
    idempotency_key: checkoutIdemKey,
    items: cart.map((i) => ({ id: i.id, size: i.size, quantity: i.qty }))
  };
  try {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name: name, phone: phone, email: email, line1: address.line1, city: address.city, region: address.region }));
  } catch (err) { /* storage full/blocked */ }

  const btn = online ? $('pay-btn') : $('place-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = online ? 'Opening Paystack…' : 'Placing order…';
  try {
    const headers = await customerAuthHeaders();
    if (online) {
      const res = await fetch('/api/checkout/paystack', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorization_url) {
        toast(data.error || 'We could not start the payment. Please try again.');
        return false;
      }
      // Remembered so the cart can drop what was paid for once we're back (see reconcilePaystack),
      // and so payment-result.html can show the receipt.
      try {
        localStorage.setItem(PAYSTACK_PENDING_KEY, JSON.stringify({
          reference: data.reference, order_number: data.order_number, created_at: new Date().toISOString(),
          items: cart.map((i) => ({ id: i.id, size: i.size, qty: i.qty })),
          receipt: Object.assign({}, receipt, {
            orderNumber: data.order_number, paymentMethod: 'Paystack', discountPercent: data.welcome_discount || 0,
            total: data.total_amount != null ? data.total_amount : Math.round(lines.reduce((sum, l) => sum + l.price * l.qty, 0) * 100) / 100
          })
        }));
      } catch (err) { /* storage blocked: the cart just keeps the items */ }
      if (data.welcome_discount) markWelcomeUsed();
      window.location.assign(data.authorization_url);
      return false;
    }

    const res = await fetch('/api/orders', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast(data.error || 'We could not place your order. Please try again.');
      return false;
    }

    let msg = 'Hello DC Kids! I\'d like to confirm my order.\n\n';
    msg += '*Order Ref:* ' + data.order_number + '\n';
    msg += '*Name:* ' + name + '\n';
    if (where) msg += '*Delivery:* ' + where + (address.landmark ? ' (' + address.landmark + ')' : '') + '\n';
    msg += '\n*Items:*\n';
    lines.forEach((it) => { msg += '• ' + it.qty + ' × ' + it.name + ' (' + it.size + ') — GH₵ ' + gh(it.price * it.qty) + '\n'; });
    if (data.welcome_discount) msg += '\n*Welcome offer:* ' + data.welcome_discount + '% off';
    msg += '\n*Total:* GH₵ ' + gh(data.total_amount) + '\n';
    if (notes) msg += '*Notes:* ' + notes + '\n';
    msg += '\n' + (orderType === 'preorder'
      ? 'This includes China pre-order items. Please send the payment details so I can pay in full before you order.'
      : 'Please let me know how to proceed with payment and delivery. Thank you!');

    if (data.welcome_discount) markWelcomeUsed();
    lastReceipt = Object.assign({}, receipt, {
      orderNumber: data.order_number, total: data.total_amount, paymentMethod: 'WhatsApp', discountPercent: data.welcome_discount || 0,
      status: data.status || (orderType === 'preorder' ? 'awaiting_payment' : 'pending') // a replayed retry carries no status
    });
    checkoutIdemKey = null;
    cart = [];
    saveCart();
    renderCart();
    $('co-notes').value = '';
    $('done-ref').textContent = data.order_number;
    $('done-wa').href = waLink(msg);
    showCartView('done');
  } catch (err) {
    // The idempotency key is kept, so retrying can never create a duplicate order.
    toast('Connection problem — please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
  return false;
}

function openLastReceipt() {
  if (lastReceipt && window.DCReceipt) window.DCReceipt.open(lastReceipt);
}

// Back from Paystack: once the payment is confirmed, take the paid-for items out of the cart.
async function reconcilePaystack() {
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PAYSTACK_PENDING_KEY) || 'null'); } catch (e) { return; }
  if (!pending || !pending.reference) return;
  try {
    const res = await fetch('/api/payments/paystack/status/' + encodeURIComponent(pending.reference), { cache: 'no-store' });
    if (!res.ok) return;
    const status = await res.json();
    if (status.payment_status === 'paid' || status.order_status === 'paid') {
      (pending.items || []).forEach((bought) => {
        const line = cart.find((i) => i.id === Number(bought.id) && String(i.size) === String(bought.size));
        if (line) line.qty -= Number(bought.qty) || 0;
      });
      cart = cart.filter((i) => i.qty > 0);
      saveCart();
      renderCart();
      localStorage.removeItem(PAYSTACK_PENDING_KEY);
      toast('Payment confirmed. Thank you! Order ' + (status.order_number || pending.order_number));
    } else if (['failed', 'review'].includes(status.payment_status) || ['payment_failed', 'payment_review'].includes(status.order_status)) {
      localStorage.removeItem(PAYSTACK_PENDING_KEY);
    }
  } catch (e) { /* offline: keep the snapshot for the next visit */ }
}

/* =============================================================== account */
function isSignedIn() { return !!(customerState.user && customerState.user.emailVerified && customerState.customer); }

async function customerAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (isSignedIn() && window.DCKidsAuth) {
    try { headers.Authorization = 'Bearer ' + await window.DCKidsAuth.getIdToken(); } catch (e) { /* guest checkout still works */ }
  }
  return headers;
}

async function applyCustomerState(state) {
  customerState = state || { user: null, customer: null };
  $('account-link').textContent = customerState.customer ? 'Account' : 'Sign in';
  $('m-account-link').textContent = customerState.customer ? 'My account' : 'Sign in';
  savedAddresses = [];
  if (catalogueLoaded) syncWishlist(); // signing in brings the account's saved pieces
  if (!isSignedIn()) return;
  try {
    const res = await fetch('/api/customer/addresses', { headers: await customerAuthHeaders() });
    if (res.ok) savedAddresses = await res.json();
  } catch (e) { /* checkout works without saved-address prefill */ }
}

/* ============================================================ store mode */
function updateModeBar() {
  const bar = $('mode-bar');
  if (!bar) return;
  const preorderOpen = preorderWindow().open;
  bar.style.display = siteConfig.wholesale_enabled || preorderOpen ? 'flex' : 'none';
  bar.querySelector('[data-mode="wholesale"]').hidden = !siteConfig.wholesale_enabled;
  const active = preorderView ? 'preorder' : (isWholesale() ? 'wholesale' : 'retail');
  bar.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === active);
    b.setAttribute('aria-pressed', String(b.dataset.mode === active));
  });
}
function setMode(mode) {
  if (preorderView) showPreorders(false);
  if (mode === 'wholesale' && !siteConfig.wholesale_enabled) return;
  if ((mode === 'wholesale') === isWholesale()) return;
  storeMode = mode;
  localStorage.setItem('storeMode', mode);
  // Re-fit cart quantities to the new mode's rules (wholesale = MOQ multiples).
  cart.forEach((i) => {
    const p = byId.get(i.id);
    if (isWholesale()) i.qty = Math.max(moq(), Math.ceil(i.qty / moq()) * moq());
    else i.qty = Math.min(i.qty, RETAIL_MAX_QTY);
    if (p) i.qty = Math.min(i.qty, maxQtyFor(p));
  });
  saveCart();
  updateModeBar();
  renderBestsellers();
  renderShop();
  renderCart();
  if ($('pdp').classList.contains('open')) { pdp.qty = isWholesale() ? moq() : 1; updatePdp(); }
  toast(isWholesale() ? 'Wholesale prices — minimum ' + moq() + ' pieces per item' : 'Showing retail prices');
}

/* ============================================================ hero slides */
// Crossfades the store/owner photos. Only the first ships with the page; each
// later one is fetched just before it's shown, keeping first paint light on 3G.
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initHeroSlides() {
  const slides = Array.prototype.slice.call(document.querySelectorAll('.hero__slide'));
  const pauseBtn = $('hero-pause');
  if (slides.length < 2) { if (pauseBtn) pauseBtn.hidden = true; return; }
  const ensureSrc = (img) => {
    if (!img || img.getAttribute('src') || !img.dataset.src) return;
    if (img.dataset.srcset) img.srcset = img.dataset.srcset; // set first so the browser picks the right size
    img.src = img.dataset.src;
  };

  let idx = 0;
  let timer = null;
  let paused = REDUCE_MOTION;
  function go(n) {
    slides[idx].classList.remove('is-active');
    idx = (n + slides.length) % slides.length;
    ensureSrc(slides[idx]);
    ensureSrc(slides[(idx + 1) % slides.length]);
    slides[idx].classList.add('is-active');
  }
  function stop() { clearInterval(timer); timer = null; }
  function start() { stop(); if (!paused) timer = setInterval(() => go(idx + 1), 5500); }

  // An auto-advancing slideshow needs a way to stop it (WCAG 2.2.2).
  if (pauseBtn) {
    if (REDUCE_MOTION) pauseBtn.hidden = true;
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.setAttribute('aria-pressed', String(paused));
      pauseBtn.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
      start();
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  window.addEventListener('load', () => ensureSrc(slides[1]));
  start();
}

// Nav look + the curtain reveal: the hero is sticky, the page slides over it.
// While it's covered, the photo pushes in slightly and the headline lifts away.
function syncChrome() {
  const nav = $('nav');
  const hero = $('hero');
  const y = window.scrollY;
  const h = hero ? hero.offsetHeight : 0;
  const overHero = !!hero && !$('pdp').classList.contains('open') && y < h - nav.offsetHeight;
  nav.classList.toggle('nav--clear', overHero);
  nav.classList.toggle('scrolled', !overHero && y > 8);
  if (!hero || REDUCE_MOTION) return;
  const p = Math.min(1, Math.max(0, y / h));
  $('hero-slides').style.transform = 'scale(' + (1 + p * 0.08).toFixed(4) + ')';
  const content = $('hero-content');
  content.style.opacity = String(Math.max(0, 1 - p * 1.6).toFixed(3));
  content.style.transform = 'translateY(' + (-p * 48).toFixed(1) + 'px)';
}

/* ========================================================== small bits */
function toast(message) {
  const wrap = $('toasts');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2800);
}

// Run dates are whole calendar days in the shopper's time zone (Ghana is UTC+0).
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatDay(iso, withYear) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}
// "17 Oct – 31 Oct 2026"; the year is written once unless the window crosses into a new one.
function runDates(starts, ends) {
  if (starts && ends) return formatDay(starts, starts.slice(0, 4) !== ends.slice(0, 4)) + ' – ' + formatDay(ends, true);
  if (ends) return 'Until ' + formatDay(ends, true);
  if (starts) return 'From ' + formatDay(starts, true);
  return '';
}

/* ======================================================== pre-order window */
// China pre-orders run in windows the owner sets in admin. Outside one, the
// section, the links to it and the pre-order pieces all stay out of the shop,
// and the server refuses pre-order items at checkout.
function preorderWindow() {
  const starts = siteConfig.preorder_starts || '';
  const ends = siteConfig.preorder_ends || '';
  const today = todayIso();
  const open = !!(starts || ends) && (!starts || today >= starts) && (!ends || today <= ends);
  return { open: open, starts: starts, ends: ends, today: today };
}
function closesLabel(ends, today) {
  const days = Math.round((new Date(ends + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  return days <= 0 ? 'Closes today' : days === 1 ? 'Closes tomorrow' : 'Closes in ' + days + ' days';
}
function initPreorderWindow() {
  const win = preorderWindow();
  document.querySelectorAll('.js-preorder-link').forEach((a) => { a.hidden = !win.open; });
  if (!win.open) return;
  $('pre-window-dates').textContent = runDates(win.starts, win.ends);
  $('pre-window-left').textContent = win.ends ? closesLabel(win.ends, win.today) : 'Open now';
  // The same rule the server applies, so only a real group invite is ever linked.
  const group = String(siteConfig.whatsapp_group_url || '');
  const hasGroup = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/.test(group);
  $('pre-group').hidden = !hasGroup;
  if (hasGroup) $('pre-group').href = group;
}

// The China Pre-Order tab swaps the page below the tabs for the pre-order view,
// the way Retail and Wholesale swap the prices. Any other tab switches back.
function showPreorders(on) {
  if (on && !preorderWindow().open) return;
  preorderView = !!on;
  document.body.classList.toggle('is-preorder-view', preorderView);
  $('preorders').hidden = !preorderView;
  updateModeBar();
  if (preorderView) {
    observeReveals($('preorders'));
    // Land on the tabs, so the view that just changed is what the shopper sees.
    window.scrollTo({ top: $('mode-bar').getBoundingClientRect().top + window.scrollY - $('nav').offsetHeight, behavior: REDUCE_MOTION ? 'auto' : 'smooth' });
  }
  if (location.hash === '#preorders' && !preorderView) history.replaceState(null, '', location.pathname + location.search);
}

// This window's pre-order pieces, filtered by category inside the tab. The
// catalogue only holds them while a window is open (see init).
const preorderShelf = { cat: 'all' };
function renderPreorders() {
  const items = products.filter(isPreorder);
  $('pre-finds').hidden = !items.length;
  if (!items.length) return;
  const counts = {};
  items.forEach((p) => { const k = catKey(p.cat); if (k) counts[k] = (counts[k] || 0) + 1; });
  if (!counts[preorderShelf.cat]) preorderShelf.cat = 'all';
  const cats = orderedCats(counts);
  $('pre-filters').innerHTML = cats.length > 1 ? ['all'].concat(cats).map((c) => {
    const on = c === preorderShelf.cat;
    return '<button type="button" class="pre__filter' + (on ? ' on' : '') + '" data-pre-cat="' + esc(c) + '" aria-pressed="' + on + '">' +
      esc(c === 'all' ? 'All' : catLabel(c)) + '</button>';
  }).join('') : '';
  const shown = preorderShelf.cat === 'all' ? items : items.filter((p) => catKey(p.cat) === preorderShelf.cat);
  $('pre-grid').innerHTML = shown.map((p, i) => cardHTML(p, i, false)).join('');
  observeReveals($('pre-grid'));
}

function initPromo() {
  const text = siteConfig.banner_enabled ? String(siteConfig.banner_text || '').trim() : '';
  if (!text) return;
  const starts = siteConfig.banner_starts || '';
  const ends = siteConfig.banner_ends || '';
  const today = todayIso();
  // Outside its run dates the announcement stays down, so a closed window is never advertised.
  if ((starts && today < starts) || (ends && today > ends)) return;
  const dates = runDates(starts, ends);
  // Only point at the pre-orders while they're open; otherwise the link would land on nothing.
  const isPreorder = /pre-?order/i.test(text) && preorderWindow().open;
  // Dismissal is per announcement and window, so a new window shows again.
  const key = text + '|' + dates;
  $('promo').dataset.key = key;
  try { if (sessionStorage.getItem('promoDismissed') === key) return; } catch (e) { /* storage blocked */ }
  $('promo-text').textContent = text;
  $('promo-dates').textContent = dates;
  $('promo-dates').hidden = !dates;
  // A pre-order announcement should land on the pre-orders, not the general shop.
  if (isPreorder) {
    const cta = $('promo').querySelector('.btn');
    if (cta) { cta.href = '#preorders'; cta.textContent = 'View pre-orders'; }
  }
  setTimeout(() => $('promo').classList.add('show'), 2400);
}
function hidePromo() {
  $('promo').classList.remove('show');
  try { sessionStorage.setItem('promoDismissed', $('promo').dataset.key || ''); } catch (e) { /* storage blocked */ }
}

function joinNewsletter(e) {
  e.preventDefault();
  const num = $('news-phone').value.trim();
  // With the live server, the footer joins the same list as the pop-up (and its consent box).
  if (welcomeOfferPercent()) {
    $('welcome-phone').value = num;
    openWelcome();
    $('news-phone').value = '';
    return false;
  }
  window.open(waLink('Hello DC Kids! Please add me to your updates list' + (num ? ' — my number is ' + num : '') + '.'), '_blank', 'noopener');
  $('news-phone').value = '';
  return false;
}

/* ================================================== WhatsApp list + welcome */
// Only the live server's settings carry the offer; the static deploy's
// settings.json does not, since there is nowhere to save a sign-up there.
function welcomeOfferPercent() {
  return Number(siteConfig.welcome_enabled) ? Math.max(0, Number(siteConfig.welcome_percent) || 0) : 0;
}
function readWelcome() {
  try { return JSON.parse(localStorage.getItem(WELCOME_KEY) || 'null'); } catch (e) { return null; }
}
// Mirrors the server's toWhatsAppDigits, so 024… and +233 24… count as one number.
function phoneKey(raw) {
  const text = String(raw || '').trim();
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('00')) digits = digits.slice(2);
  if (/^0\d{9}$/.test(digits)) digits = '233' + digits.slice(1);
  if (/^[25]\d{8}$/.test(digits)) digits = '233' + digits;
  return digits;
}
// The welcome % this checkout will most likely get. The server has the final
// say (it knows whether the number already used it); this only previews it.
function expectedWelcomePercent() {
  const joined = readWelcome();
  if (!joined || !(joined.percent > 0) || isWholesale()) return 0;
  return phoneKey($('co-phone').value) === phoneKey(joined.phone) ? joined.percent : 0;
}
function markWelcomeUsed() {
  const joined = readWelcome();
  if (!joined) return;
  try { localStorage.setItem(WELCOME_KEY, JSON.stringify({ phone: joined.phone, percent: 0 })); } catch (e) { /* storage blocked */ }
}
function renderCheckoutTotal() {
  const subtotal = cartSubtotal();
  const percent = expectedWelcomePercent();
  const off = Math.round(subtotal * percent) / 100;
  $('co-welcome').hidden = !percent;
  $('co-welcome-pct').textContent = percent;
  $('co-welcome-amt').textContent = '−GH₵ ' + gh(off);
  $('cart-total-2').textContent = 'GH₵ ' + gh(subtotal - off);
  // Typed a different number? Say which one the offer belongs to.
  const joined = readWelcome();
  const linkedElsewhere = !percent && joined && joined.percent > 0 && !isWholesale() && $('co-phone').value.trim() !== '';
  $('co-welcome-hint').hidden = !linkedElsewhere;
  if (linkedElsewhere) $('co-welcome-hint').textContent = 'Your ' + joined.percent + '% welcome offer is for ' + joined.phone + '. Check out with that number to use it.';
}

function openWelcome() {
  const dialog = $('welcome');
  if (dialog.open || typeof dialog.showModal !== 'function') return;
  $('welcome-pct').textContent = welcomeOfferPercent() + '% off';
  $('welcome-error').hidden = true;
  dialog.showModal();
  if (!$('welcome-phone').value) $('welcome-phone').focus();
}
function closeWelcome() {
  const dialog = $('welcome');
  if (!dialog.open) return;
  dialog.close();
  if (!readWelcome()) {
    try { localStorage.setItem(WELCOME_SNOOZE_KEY, String(Date.now())); } catch (e) { /* storage blocked: it may show again */ }
  }
}
function initWelcome() {
  const dialog = $('welcome');
  if (!welcomeOfferPercent() || typeof dialog.showModal !== 'function' || readWelcome()) return;
  // Escape and the backdrop close it the same way the buttons do.
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeWelcome(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeWelcome(); });
  let snoozedAt = 0;
  try { snoozedAt = Number(localStorage.getItem(WELCOME_SNOOZE_KEY)) || 0; } catch (e) { /* storage blocked */ }
  if (Date.now() - snoozedAt < WELCOME_SNOOZE_MS) return;
  // Let the shopper look around first, and never cover a cart, product or search they have open.
  const tryOpen = () => {
    const busy = ['cart', 'pdp', 'm-menu', 'search'].some((id) => $(id).classList.contains('open')) || document.querySelector('dialog[open]');
    if (busy) setTimeout(tryOpen, 5000);
    else if (!readWelcome()) openWelcome();
  };
  setTimeout(tryOpen, WELCOME_DELAY_MS);
}
async function joinWelcome(e) {
  e.preventDefault();
  const phone = $('welcome-phone').value.trim();
  const problem = phone.replace(/\D/g, '').length < 9
    ? 'Enter your WhatsApp number, e.g. 024 123 4567.'
    : (!$('welcome-consent').checked ? 'Tick the box so we may message you on WhatsApp.' : '');
  $('welcome-error').textContent = problem;
  $('welcome-error').hidden = !problem;
  if (problem) { $(phone.replace(/\D/g, '').length < 9 ? 'welcome-phone' : 'welcome-consent').focus(); return false; }

  const btn = $('welcome-submit');
  btn.disabled = true;
  btn.textContent = 'Joining…';
  try {
    const res = await fetch('/api/whatsapp-signups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone, consent: true })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      $('welcome-error').textContent = data.error || 'We could not add you right now. Please try again.';
      $('welcome-error').hidden = false;
      return false;
    }
    const percent = data.eligible ? Number(data.percent) || 0 : 0;
    try { localStorage.setItem(WELCOME_KEY, JSON.stringify({ phone: phone, percent: percent })); } catch (err) { /* storage blocked */ }
    // The offer is tied to this number, so checkout should start with it.
    $('co-phone').value = phone;
    renderCheckoutTotal();
    $('welcome-kicker').textContent = 'You\'re on the list';
    $('welcome-title').textContent = percent ? 'Your ' + percent + '% is waiting' : 'Thanks for joining';
    $('welcome-text').textContent = percent
      ? 'Check out with ' + phone + ' and ' + percent + '% comes off your first order.'
      : 'This number has already had its welcome discount, but you\'ll still hear about new arrivals first.';
    $('welcome-form').hidden = true;
    $('welcome-skip').hidden = true;
    $('welcome-shop').hidden = false;
    $('welcome-shop').focus();
  } catch (err) {
    $('welcome-error').textContent = 'Connection problem. Please try again.';
    $('welcome-error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get my discount';
  }
  return false;
}

function applyWaLinks() {
  document.querySelectorAll('.js-wa-link').forEach((a) => {
    a.href = waLink(a.dataset.msg || 'Hello DC Kids!');
    a.target = '_blank';
    a.rel = 'noopener';
  });
}

function wireCollectionsPeek() {
  const list = $('collections-list');
  const peek = $('coll-peek');
  if (!list || !peek || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.coll');
    if (!row) { peek.classList.remove('show'); return; }
    if (peek.dataset.src !== row.dataset.img) { peek.src = row.dataset.img; peek.dataset.src = row.dataset.img; }
    peek.style.left = e.clientX + 'px';
    peek.style.top = e.clientY + 'px';
    peek.classList.add('show');
  });
  list.addEventListener('mouseleave', () => peek.classList.remove('show'));
}

function wireEvents() {
  // One frame per scroll burst — transforms/opacity only, so it stays smooth on cheap phones.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; syncChrome(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  syncChrome();

  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  document.addEventListener('click', (e) => {
    const save = e.target.closest('[data-save], [data-unsave]');
    if (save) { toggleWishlist(save.dataset.save || save.dataset.unsave); return; }
    const card = e.target.closest('a.card');
    if (card && /^#product-\d+$/.test(card.getAttribute('href'))) pdpFromNav = true;
    // The search panel sits above the product page, so step out of it first.
    if (card && card.closest('#search')) closeSearch(false);
    const suggestion = e.target.closest('.search__chip');
    if (suggestion) { $('search-input').value = suggestion.dataset.q; renderSearch(); $('search-input').focus(); }
    const coll = e.target.closest('.coll, .card--edit');
    if (coll) { shop.q = ''; if ($('shop-search')) $('shop-search').value = ''; setShopCat(coll.dataset.cat); }
    const chip = e.target.closest('.cat-chip');
    if (chip) setShopCat(chip.dataset.cat);
    const shelf = e.target.closest('[data-pre-cat]');
    if (shelf) { preorderShelf.cat = shelf.dataset.preCat; renderPreorders(); }
    const size = e.target.closest('.size-chip');
    if (size) { pdp.size = size.dataset.size; updatePdp(); }
  });

  let searchTimer = null;
  const search = $('shop-search');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        shop.q = search.value;
        // Search spans the whole catalogue — drop any category filter.
        if (shop.q) shop.cat = 'all';
        shop.shown = PAGE_SIZE;
        renderShopCats();
        renderShop();
      }, 180);
    });
  }

  let searchPanelTimer = null;
  const searchInput = $('search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchPanelTimer);
    searchPanelTimer = setTimeout(renderSearch, 120);
  });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') viewAllResults(); });
  wireCollectionsPeek();

  $('co-phone').addEventListener('input', renderCheckoutTotal);
  $('co-saved').addEventListener('change', (e) => {
    const picked = savedAddresses.find((a) => String(a.id) === e.target.value);
    if (picked) fillAddress(picked);
  });
  window.addEventListener('dckids-auth-change', (e) => applyCustomerState(e.detail));
  if (window.DCKidsAuth) applyCustomerState(window.DCKidsAuth.getState());

  // Chromium offers installation; a small pill replaces the browser's own auto-popup.
  let installPrompt = null;
  const installBtn = $('pwa-install');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; installBtn.hidden = false; });
  installBtn.addEventListener('click', () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => { installPrompt = null; installBtn.hidden = true; });
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; installBtn.hidden = true; });
}

// Links from the product page and search engines: ?category=shoes, ?openCart=1, ?q=romper.
function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  if (!['category', 'openCart', 'q'].some((k) => params.has(k))) return;
  const cat = catKey(params.get('category'));
  if (cat && categoryCounts()[cat]) setShopCat(cat);
  const q = (params.get('q') || '').trim();
  if (q) { $('search-input').value = q; openSearch(); }
  else if (params.get('openCart') === '1' && cart.length) openCart();
  history.replaceState(null, '', location.pathname + location.hash);
}

/* =================================================================== boot */
function normalizeProducts(list) {
  return (Array.isArray(list) ? list : []).map((p) => {
    const cat = catKey(p.cat) === 'baby' ? 'newborn' : catKey(p.cat) === 'bags' ? 'accessories' : p.cat;
    // The live API sends what is still buyable after open orders; the static
    // products.json only has the raw count.
    const stock = p.available !== undefined ? p.available : p.stock;
    return Object.assign({}, p, {
      id: Number(p.id),
      cat: cat,
      price: Number(p.price || 0),
      stock: (stock === null || stock === undefined || stock === '') ? null : Number(stock)
    });
  }).filter((p) => p.id && p.name);
}

// The admin's settings come from the API. The static deploy (Vercel) has no
// server, so it reads the same public fields from settings.json instead —
// otherwise it would lose the announcement and the retail/wholesale switch.
async function loadSettings() {
  for (const url of ['/api/settings', '/settings.json']) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      // A static host answers /api/settings with a 404 page (or index.html), never JSON.
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) return (await res.json()) || {};
    } catch (e) { /* unreachable: try the next source */ }
  }
  return {};
}

async function loadCatalogue() {
  try {
    const res = await fetch('/api/products');
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('application/json')) {
      const data = normalizeProducts(await res.json());
      if (data.length) { catalogueFromApi = true; return data; }
    }
  } catch (e) { /* fall through to the static catalogue */ }
  try {
    const res = await fetch('products.json');
    if (res.ok) return normalizeProducts(await res.json());
  } catch (e) { /* offline with no cache */ }
  return [];
}

async function init() {
  $('year').textContent = new Date().getFullYear();
  loadCart();
  wishlist = readGuestWishlist();
  wireEvents();
  initHeroSlides();
  observeReveals();
  $('bestsellers-grid').innerHTML = skeletonHTML(6);
  $('product-grid').innerHTML = skeletonHTML(6);

  // Settings, the Paystack switch and the catalogue don't depend on each
  // other, so they load side by side: on 3G each round trip costs a second.
  const catalogueReady = loadCatalogue();
  const paystackReady = fetch('/api/payments/paystack/config', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : {}))
    .then((cfg) => cfg.enabled === true)
    .catch(() => false); // WhatsApp checkout still works
  siteConfig = await loadSettings();
  paystackEnabled = await paystackReady;
  if (!siteConfig.wholesale_enabled && storeMode === 'wholesale') {
    storeMode = 'retail';
    localStorage.setItem('storeMode', 'retail');
  }
  updateModeBar();
  applyWaLinks();
  initPreorderWindow();
  initPromo();
  initWelcome();

  products = await catalogueReady;
  // Outside a window the pre-order pieces aren't for sale, so they leave the shop
  // (and any cart) entirely rather than failing at checkout.
  if (!preorderWindow().open) products = products.filter((p) => !isPreorder(p));
  byId = new Map(products.map((p) => [p.id, p]));
  catalogueLoaded = true;
  if ($('search').classList.contains('open')) renderSearch();

  if (!products.length) {
    const msg = '<div class="shop-empty">We couldn\'t load the catalogue right now. Please refresh, or <a class="link-underline js-wa-link" data-msg="Hello DC Kids! I\'d like to place an order.">order on WhatsApp</a>.</div>';
    $('bestsellers-grid').innerHTML = msg;
    $('product-grid').innerHTML = '';
    applyWaLinks();
    renderCart();
    return;
  }

  // Drop cart lines whose product no longer exists (stale cart after a catalogue swap).
  const before = cart.length;
  cart = cart.filter((i) => byId.has(i.id));
  if (cart.length !== before) saveCart();

  renderCart();
  renderBestsellers();
  renderCollections();
  renderShopCats();
  renderShop();
  renderPreorders();
  syncWishlist();

  if (/^#product-\d+$/.test(location.hash) || location.hash === '#preorders') onHashChange();
  applyUrlParams();
  reconcilePaystack();
}

document.addEventListener('DOMContentLoaded', init);
