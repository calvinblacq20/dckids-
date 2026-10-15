/* DC Kids Brand — service worker
   Strategy:
   - HTML pages: NETWORK-FIRST (so layout edits show up immediately),
     fall back to cache when offline.
   - JS + CSS: NETWORK-FIRST too. App logic changes (e.g. checkout) must reach
     the browser on a normal refresh; cache-first here strands users on stale
     code until VERSION is bumped, which once broke order submission.
   - API: network-first, runtime-cache fallback.
   - Images + fonts: cache-first.
   - Bumping VERSION wipes old caches on activate.
*/
const VERSION = 'dckids-v279';
const STATIC_CACHE = 'dckids-static-' + VERSION;
const RUNTIME_CACHE = 'dckids-runtime-' + VERSION;

// App shell. HTML pages stay network-first; index.html + admin.html are precached
// only so an offline navigation has a correct same-section fallback (an admin
// navigation must never be answered with the storefront).
const APP_SHELL = [
  '/index.html',
  '/admin.html',
  '/account.html',
  '/product.html',
  '/support.html',
  '/payment-result.html',
  '/styles.css',
  '/product.css',
  '/tailwind-storefront.css',
  '/tailwind-admin.css',
  '/admin-bridge.css',
  '/admin-system.css',
  '/vendor/chart.umd.js',
  '/vendor/fonts/fonts.css',
  '/vendor/fonts/files/inter-latin-opsz-normal.woff2',
  '/vendor/fonts/files/playfair-display-latin-wght-normal.woff2',
  '/vendor/fonts/files/fragment-mono-latin-400-normal.woff2',
  '/vendor/fontawesome/css/all.min.css',
  '/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/vendor/fontawesome/webfonts/fa-regular-400.woff2',
  '/vendor/fontawesome/webfonts/fa-brands-400.woff2',
  '/image-resolver.js',
  '/admin-recovery-view.js',
  '/account.js',
  '/product.js',
  '/payment-result.js',
  '/firebase-auth.js',
  '/manifest.json',
  '/icon.png',
  // The launch screen's layers, so it paints at once on a return visit.
  '/brand/splash-dc.webp?v=2',
  '/brand/splash-mark.webp?v=2',
  '/brand/splash-tagline.webp?v=2',
  '/images/placeholder.svg',
  '/images/category-fallbacks/newborn.webp',
  '/images/category-fallbacks/clothing.webp',
  '/images/category-fallbacks/shoes.webp',
  '/images/category-fallbacks/feeding.webp',
  '/images/category-fallbacks/gear.webp',
  '/images/category-fallbacks/bathcare.webp',
  '/images/category-fallbacks/essentials.webp',
  '/images/category-fallbacks/accessories.webp',
  '/images/category-fallbacks/bedding.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Tell the page to reload once the new SW takes control (one-time)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// caches.match() resolves to undefined on a miss, and respondWith(undefined)
// throws "Failed to convert value to 'Response'" — which surfaces as a broken
// request with no useful error. Every fallback here funnels through this, so a
// miss becomes an honest 504 instead of a TypeError.
const offlineResponse = (accept) => new Response(
  (accept || '').includes('text/html')
    ? '<!doctype html><meta charset="utf-8"><title>Offline</title><p>This page is not available offline.</p>'
    : JSON.stringify({ error: 'Offline and not cached' }),
  {
    status: 504,
    headers: {
      'Content-Type': (accept || '').includes('text/html') ? 'text/html; charset=utf-8' : 'application/json',
      'Cache-Control': 'no-store'
    }
  }
);

// An image request must fail as an image. The cached placeholder is preferred;
// if even that is missing, this inline copy keeps the slot a picture rather
// than a broken icon or a JSON body.
const imageFallback = () =>
  caches.match('/images/placeholder.svg').then((hit) => hit || new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
    + '<rect width="64" height="64" fill="#f3f4f6"/>'
    + '<path d="M18 40l9-11 7 8 5-6 7 9z" fill="#d1d5db"/>'
    + '<circle cx="24" cy="23" r="4" fill="#d1d5db"/></svg>',
    { status: 200, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } }
  ));

const cachedOr = (request, fallbackPath, accept) =>
  caches.match(request)
    .then((hit) => hit || (fallbackPath ? caches.match(fallbackPath) : undefined))
    .then((hit) => hit || offlineResponse(accept));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const accept = req.headers.get('accept') || '';
  const isHtml = req.mode === 'navigate' || accept.includes('text/html') || url.pathname.endsWith('.html');
  const isApi = url.pathname.startsWith('/api/');
  const carriesIdentity = req.headers.has('authorization');
  const isPrivateCustomerApi = url.pathname.startsWith('/api/customer/') || url.pathname.startsWith('/api/wishlist');
  const isPaymentApi = url.pathname.startsWith('/api/payments/') || url.pathname.startsWith('/api/checkout/paystack');
  const isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  const isImage = req.destination === 'image' || /\.(?:png|jpe?g|gif|svg|webp|avif)$/i.test(url.pathname);

  // Live store config must NEVER be served from cache — always go to network so
  // admin changes (banner, discount, WhatsApp) reach shoppers immediately.
  const isLiveConfig = url.pathname === '/api/settings' || url.pathname === '/api/products' || /^\/api\/products\/\d+$/.test(url.pathname);
  if (isLiveConfig) {
    event.respondWith(fetch(req).catch(() => cachedOr(req, null, accept)));
    return;
  }

  // Customer/profile responses must never enter Cache Storage. Cache matching
  // does not isolate users by Authorization header, so an offline fallback
  // could otherwise expose the previous customer's private data on a shared
  // device. Authenticated storefront calls (orders/reviews) follow this rule too.
  if (isApi && (carriesIdentity || isPrivateCustomerApi || isPaymentApi)) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'Account data is unavailable while offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    )));
    return;
  }

  // HTML + JS/CSS + API: network-first, cache fallback.
  if (isHtml || isApi || isCode) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => {
        if (r) return r;

        // Only a navigation may fall back to a page. This used to apply to
        // every uncached request, and the path test matched more than it
        // looked: "/admin.js".startsWith("/admin") is true, so a script whose
        // fetch failed was answered with admin.html. The browser then parsed
        // HTML as JavaScript, threw "Unexpected token '<'", and admin.js never
        // defined its handlers — leaving a page that renders but whose buttons
        // do nothing. A script or stylesheet must fail as itself.
        if (!isHtml) return offlineResponse(accept);

        // Keep an admin navigation on the admin shell: falling back to
        // /index.html bounced the login page to the storefront whenever the
        // network blipped (e.g. the reload right after a new SW takes control).
        const fallback = url.pathname.startsWith('/admin')
          ? '/admin.html'
          : (url.pathname.startsWith('/account')
            ? '/account.html'
            : (url.pathname.startsWith('/product') ? '/product.html' : '/index.html'));
        return cachedOr(fallback, null, accept);
      }))
    );
    return;
  }

  // Images + fonts: cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || !res.ok) {
          if (isImage) return imageFallback();
          return res;
        }
        if (res.type === 'basic') {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => isImage ? imageFallback() : cachedOr(req, null, accept));
    })
  );
});
