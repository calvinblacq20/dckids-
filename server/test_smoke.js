// Smoke tests: boots the real server on a throwaway port + database and
// exercises the critical paths end-to-end. Run with `npm test` from server/.
// No test framework — plain assertions, exit 1 on any failure — so it runs
// anywhere Node runs, including a fresh clone with only `npm install` done.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TEST_PORT = 3041;
const TEST_DB = path.join(__dirname, '_smoketest.db');
const BASE = `http://localhost:${TEST_PORT}`;

// Set (not delete) every env var the server reads: dotenv loads server/.env at
// require time but never overrides variables that are already set, so explicit
// values here insulate the test from whatever the operator has in .env.
process.env.PORT = String(TEST_PORT);
process.env.DB_PATH = TEST_DB;
process.env.NODE_ENV = 'test';              // dev mode: localhost bypasses rate limits
process.env.RESEND_API_KEY = '';            // emails log to console instead of sending
process.env.OWNER_EMAIL = 'owner@test.com'; // the test's first sign-up is the owner
process.env.FIREBASE_API_KEY = 'smoke-public-api-key';
process.env.FIREBASE_AUTH_DOMAIN = 'smoke-test.firebaseapp.com';
process.env.FIREBASE_PROJECT_ID = 'smoke-test';
process.env.FIREBASE_APP_ID = '1:123:web:smoke';
process.env.PAYSTACK_SECRET_KEY = 'paystack-smoke-secret';
process.env.PAYSTACK_AKUA_WEBHOOK_URL = 'https://akua.example.test/api/payments/paystack/webhook';
process.env.PAYSTACK_LEGACY_WEBHOOK_URL = 'https://legacy.example.test/paystack';
process.env.SHOP_NOTIFY_EMAIL = 'shop@test.com';
process.env.JWT_SECRET = 'smoke-jwt-secret-used-only-by-tests';

let passed = 0;
let failed = 0;
const uploadedTestFiles = [];
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

function cleanupDb() {
    ['', '-wal', '-shm'].forEach(ext => {
        try { fs.unlinkSync(TEST_DB + ext); } catch (e) { /* not present */ }
    });
    uploadedTestFiles.forEach(rel => {
        try { fs.unlinkSync(path.join(__dirname, '..', rel)); } catch (e) { /* not present */ }
    });
}

// The OTP flow emails a 6-digit code; without RESEND_API_KEY the server prints
// it as "[SIGN-IN CODE] email -> 123456". Capture it from console output.
let lastOtp = '';
const origLog = console.log;
console.log = function (...args) {
    const s = args.join(' ');
    const m = /\[SIGN-IN CODE\]\s+\S+\s+->\s+(\d{6})/.exec(s);
    if (m) lastOtp = m[1];
    origLog.apply(console, args);
};

async function waitForServer(tries) {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(`${BASE}/api/settings`);
            if (r.ok) return true;
        } catch (e) { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

const json = (method, body, extraHeaders) => ({
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
    body: JSON.stringify(body)
});

async function run() {
    cleanupDb();
    const app = require('./server'); // boots on TEST_PORT against TEST_DB
    const firebaseTokens = {
        'verified-new': { uid: 'firebase-new', email: 'new.customer@test.com', email_verified: true, name: 'New Customer' },
        'verified-second': { uid: 'firebase-second', email: 'second.customer@test.com', email_verified: true, name: 'Second Customer' },
        'verified-conflict': { uid: 'firebase-conflict', email: 'new.customer@test.com', email_verified: true, name: 'Conflict' },
        'verified-legacy': { uid: 'firebase-legacy', email: 'legacy.customer@test.com', email_verified: true, name: 'Firebase Name' },
        unverified: { uid: 'firebase-unverified', email: 'unverified@test.com', email_verified: false, name: 'Unverified' }
    };
    app.set('verifyCustomerIdToken', async (token) => {
        if (token === 'expired' || token === 'malformed' || !firebaseTokens[token]) {
            const error = new Error(token === 'expired' ? 'Firebase ID token has expired' : 'Invalid Firebase ID token');
            error.code = token === 'expired' ? 'auth/id-token-expired' : 'auth/argument-error';
            throw error;
        }
        return firebaseTokens[token];
    });
    let paystackInitializePayload = null;
    let ownerPaymentEmails = 0;
    let forwardedAkuaWebhookBody = '';
    let forwardedAkuaWebhookSignature = '';
    let akuaForwardingShouldFail = false;
    let forwardedWebhookBody = '';
    let forwardingShouldFail = false;
    app.set('paystackApiRequest', async (apiPath, method, payload) => {
        if (apiPath === '/transaction/initialize' && method === 'POST') {
            paystackInitializePayload = payload;
            return { authorization_url: `https://checkout.paystack.test/${payload.reference}`, reference: payload.reference, access_code: 'access-smoke' };
        }
        return { status: 'pending' };
    });
    app.set('sendOrderNotificationEmail', async () => { ownerPaymentEmails++; return { ok: true }; });
    app.set('forwardAkuaPaystackWebhook', async (rawBody, signature) => {
        if (akuaForwardingShouldFail) throw new Error('Akua unavailable');
        forwardedAkuaWebhookBody = rawBody.toString('utf8');
        forwardedAkuaWebhookSignature = signature;
        return { ok: true };
    });
    app.set('forwardLegacyPaystackWebhook', async (rawBody) => {
        if (forwardingShouldFail) throw new Error('legacy unavailable');
        forwardedWebhookBody = rawBody.toString('utf8');
        return { ok: true };
    });
    const db = require('./db');
    const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params || [], function(err) { err ? reject(err) : resolve(this); }));
    const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row)));

    async function postPaystackWebhook(event, signatureOverride) {
        const raw = JSON.stringify(event);
        const signature = signatureOverride || crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
        return fetch(`${BASE}/api/payments/paystack/webhook`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature }, body: raw
        });
    }

    const up = await waitForServer(30);
    if (!up) { console.error('FATAL: server did not start'); process.exit(1); }

    const healthResponse = await fetch(`${BASE}/api/health`);
    const healthBody = await healthResponse.text();
    let healthPayload = {};
    try { healthPayload = JSON.parse(healthBody); } catch (error) { /* assertion below reports a missing JSON health route */ }
    check('health check proves SQLite readiness without exposing configuration',
        healthResponse.status === 200 && healthPayload.status === 'ok' && healthPayload.database === 'ready' &&
        typeof healthPayload.persistentStorage === 'boolean' &&
        Object.keys(healthPayload).sort().join(',') === 'database,persistentStorage,status',
        healthBody);

    // ---- fresh-database boot: seeded from the products.json snapshot ----
    const products = await (await fetch(`${BASE}/api/products`)).json();
    check('fresh DB seeds full catalogue', Array.isArray(products) && products.length >= 200, `got ${products.length}`);
    let productDetailResponse = await fetch(`${BASE}/api/products/1`);
    const productDetail = await productDetailResponse.json();
    check('public product detail returns catalogue item and gallery', productDetailResponse.status === 200 && productDetail.id === 1 && Array.isArray(productDetail.images));
    productDetailResponse = await fetch(`${BASE}/api/products/not-a-number`);
    check('product detail rejects malformed IDs', productDetailResponse.status === 400, `status ${productDetailResponse.status}`);
    productDetailResponse = await fetch(`${BASE}/api/products/999999`);
    check('product detail returns 404 for missing items', productDetailResponse.status === 404, `status ${productDetailResponse.status}`);
    const catsWithProducts = new Set(products.map(p => p.cat));
    check('all storefront categories populated',
        ['clothing', 'shoes', 'feeding', 'gear', 'bathcare', 'bedding'].every(c => catsWithProducts.has(c)),
        `cats: ${[...catsWithProducts].join(',')}`);
    const seededSkus = products.map(p => String(p.sku || ''));
    check('fresh catalogue has no blank SKUs', seededSkus.every(Boolean));
    check('fresh catalogue SKUs are unique', new Set(seededSkus).size === seededSkus.length);
    check('SKU prefixes cover every category', products.every(p => /^(CLO|SHO|ACC|NEW|BED|ESS|FEE|GEA|BAT)-\d{4}$/.test(p.sku)), 'unexpected SKU prefix');
    const categoryAssets = ['newborn','clothing','shoes','feeding','gear','bathcare','essentials','accessories','bedding'];
    const categoryImageCount = products.filter(p => /^images\/category-fallbacks\/[a-z]+\.webp$/.test(p.img || '')).length;
    check('placeholder products reuse category artwork', categoryImageCount >= 180, `got ${categoryImageCount}`);
    check('all category fallback assets exist', categoryAssets.every(name => fs.existsSync(path.join(__dirname, '..', 'images', 'category-fallbacks', name + '.webp'))));
    const imageResolver = require('../image-resolver');
    check('all categories resolve to their matching fallback', categoryAssets.every(name => imageResolver.resolve({ cat: name, img: 'images/placeholder.svg' }).src === 'images/category-fallbacks/' + name + '.webp'));
    check('stored category artwork remains visibly labelled', categoryAssets.every(name => {
        const resolved = imageResolver.resolve({ cat: name, img: 'images/category-fallbacks/' + name + '.webp' });
        return resolved.src === 'images/category-fallbacks/' + name + '.webp' && resolved.isCategoryFallback === true && imageResolver.isGenuineImage(resolved.src) === false;
    }));
    check('legacy logo duplicates resolve as category artwork', ['product_50.jpg', 'product_66.jpg', 'product_83.jpg'].every(name => {
        const resolved = imageResolver.resolve({ cat: 'shoes', img: 'images/' + name });
        return resolved.src === 'images/category-fallbacks/shoes.webp' && resolved.isCategoryFallback === true;
    }));
    check('source catalogue contains no known logo placeholders', products.every(p => !imageResolver.isKnownLogoPlaceholder(p.img)));
    const realImage = imageResolver.resolve({ cat: 'clothing', img: 'images/product_42.jpg' });
    check('genuine product images remain unchanged', realImage.src === 'images/product_42.jpg' && realImage.isCategoryFallback === false);
    const swSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    check('service worker caches category fallbacks', categoryAssets.every(name => swSource.includes('/images/category-fallbacks/' + name + '.webp')));
    check('service worker image failure returns SVG placeholder',
        swSource.includes("isImage ? imageFallback()") && swSource.includes("caches.match('/images/placeholder.svg')"));
    // respondWith(undefined) throws "Failed to convert value to 'Response'", and
    // a page fallback served for a script yields "Unexpected token '<'". Both
    // leave a page that renders with dead handlers, so both are asserted here.
    check('service worker never falls back to a page for a non-navigation',
        swSource.includes('if (!isHtml) return offlineResponse(accept);'));
    check('service worker cache misses resolve to a Response',
        swSource.includes('hit || offlineResponse(accept)'));
    check('service worker includes offline product page assets', ['/product.html', '/product.css', '/product.js'].every(asset => swSource.includes(asset)));
    const storefrontSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const customerAuthSource = fs.readFileSync(path.join(__dirname, '..', 'firebase-auth.js'), 'utf8');
    check('Google customer sign-in is popup-first on every device',
        customerAuthSource.indexOf('signInWithPopup(auth, provider)') < customerAuthSource.indexOf('signInWithRedirect(auth, provider)') &&
        !customerAuthSource.includes('likelyMobile'));
    check('Google redirect fallback still restores Firebase auth state',
        customerAuthSource.indexOf('onIdTokenChanged(auth') < customerAuthSource.indexOf('getRedirectResult(auth)'));
    check('checkout includes visible validation feedback and back navigation',
        storefrontSource.includes('id="co-error" role="alert"') && storefrontSource.includes('onclick="showCartView(\'items\')"'));
    check('Paystack validation returns customers to their missing details',
        appSource.includes('$(firstBad[0]).focus()') && appSource.includes('Enter a valid email address to pay with Paystack.'));
    const storeStylesSource = fs.readFileSync(path.join(__dirname, '..', 'store.css'), 'utf8');
    const accountStylesSource = fs.readFileSync(path.join(__dirname, '..', 'account.css'), 'utf8');
    check('install prompt remains below drawers and checkout overlays',
        storeStylesSource.includes('.pwa-fab { position: fixed; left: 16px; bottom: 18px; z-index: 85;') &&
        /\.nav \{\s+position: fixed; top: 0; left: 0; right: 0; z-index: 90;/.test(storeStylesSource));
    check('cart drawers fill the viewport and clear the phone safe area',
        /\.cart \{\s+position: fixed; top: 0; right: 0; bottom: 0;/.test(storeStylesSource) &&
        storeStylesSource.includes('.cart__foot { padding: 22px 26px calc(22px + env(safe-area-inset-bottom));') &&
        fs.readFileSync(path.join(__dirname, '..', 'product.css'), 'utf8').includes('calc(12px + env(safe-area-inset-bottom))'));
    check('mobile account tabs expose overflow and active light-theme contrast',
        accountStylesSource.includes('.account-tabs { position: static; flex-direction: row; overflow-x: auto;') &&
        accountStylesSource.includes('.account-tab.is-active { color: var(--ink);') &&
        !accountStylesSource.includes('prefers-color-scheme: dark'));
    check('pre-order banner avoids stale dated messaging',
        storefrontSource.includes('Message us on WhatsApp for the current closing date.') &&
        !storefrontSource.includes('Orders close May 18th') &&
        !storefrontSource.includes('Ends May 18'));
    const productPageSource = fs.readFileSync(path.join(__dirname, '..', 'product.html'), 'utf8');
    const productStylesSource = fs.readFileSync(path.join(__dirname, '..', 'product.css'), 'utf8');
    const supportPageSource = fs.readFileSync(path.join(__dirname, '..', 'support.html'), 'utf8');
    const adminPageSource = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
    check('admin dashboard uses live metrics and exposes working overview controls',
        adminPageSource.includes('id="dashboard-refresh-btn"') &&
        // The period control moved into the page head when the dashboard was
        // rebuilt on the reference patterns; the capability is unchanged.
        adminPageSource.includes('id="dash-period"') &&
        adminSource.includes("fetch(API_URL + '/analytics/sales' + dashboardAnalyticsQuery(period)") &&
        !adminSource.includes("totalEl.textContent = '1,245'") &&
        !adminSource.includes('var inStock = 870'));
    check('admin customers, suppliers, and activity use server-backed interfaces',
        adminPageSource.includes('id="modal-audit-log"') &&
        adminSource.includes("fetch(API_URL + '/admin/customers'") &&
        adminSource.includes("fetch(API_URL + '/suppliers'") &&
        adminSource.includes("fetch(API_URL + '/admin/audit-log?limit=100'") &&
        !adminSource.includes("localStorage.setItem('dcKidsCustomers'") &&
        !adminSource.includes("localStorage.setItem('dcKidsSuppliers'"));
    check('obsolete browser-only admin password controls are retired',
        !adminPageSource.includes('modal-settings-password') &&
        !adminSource.includes('dcKidsAdminPwHash') &&
        !adminSource.includes('function updatePassword()'));
    check('legacy dashboard demo records and fake notification badge are retired',
        adminPageSource.includes('id="notification-count" class="notification-badge" style="display:none;">0</span>') &&
        !adminPageSource.includes('New order #1042 received') &&
        !adminSource.includes('function seedDemoDataForPreview()') &&
        adminSource.includes("localStorage.setItem('dcKidsDemoSeedsRetired', 'true')"));
    check('admin settings exposes accessible recovery-code management',
        adminPageSource.includes('id="recovery-security-card"') &&
        adminPageSource.includes('id="recovery-code-status" role="status" aria-live="polite"') &&
        adminPageSource.includes('id="recovery-code-regenerate-btn"') &&
        adminSource.includes('async function loadRecoveryCodeStatus()') &&
        adminSource.includes('async function regenerateRecoveryCodes()') &&
        adminSource.includes("recoveryLink.parentElement.hidden = (step === 'recovery')"));
    check('mobile product page exposes a synchronized quick-add bar',
        productPageSource.includes('id="productMobileBuybar"') &&
        productStylesSource.includes('.product-mobile-buybar') &&
        fs.readFileSync(path.join(__dirname, '..', 'product.js'), 'utf8').includes("byId('productMobileAdd').addEventListener('click', addToCart)"));
    check('storefront footer has no placeholder destinations or unrelated contact number',
        !storefrontSource.includes('<a href="#" class="hover:text-white transition-colors">') &&
        !storefrontSource.includes('+233 59 123 4567') &&
        storefrontSource.includes('tel:+233549193805'));
    check('customers can open a receipt after checkout, after paying, when tracking and in their account',
        storefrontSource.includes('src="receipt.js') && appSource.includes('function openLastReceipt') &&
        ['track.html', 'account.html', 'payment-result.html'].every((page) =>
            fs.readFileSync(path.join(__dirname, '..', page), 'utf8').includes('src="receipt.js')));
    const serverSourceForBanner = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const defaultBanner = (serverSourceForBanner.match(/const DEFAULT_STORE_BANNER = '([^']+)'/) || [])[1];
    check('a static deploy (no API) still shows the default pre-order announcement',
        !!defaultBanner && appSource.includes("banner_text: '" + defaultBanner + "'") && appSource.includes('siteConfig = STATIC_SETTINGS'));
    check('the storefront no longer asks for a pre-order deposit',
        !/deposit/i.test(storefrontSource) && !/deposit/i.test(appSource));
    check('customer-care page covers linked support sections',
        ['id="faqs"', 'id="shipping"', 'id="returns"', 'id="size-guide"', 'id="about"'].every((section) => supportPageSource.includes(section)));

    // ---- static frontend ----
    for (const page of ['/', '/admin.html', '/track.html', '/account.html', '/product.html?id=1', '/support.html']) {
        const r = await fetch(`${BASE}${page}`);
        check(`serves ${page}`, r.status === 200, `status ${r.status}`);
    }

    let r = await fetch(`${BASE}/api/customer/auth/config`);
    const firebaseConfig = await r.json();
    check('customer auth config returns only public Firebase fields',
        r.status === 200 && Object.keys(firebaseConfig).sort().join(',') === 'apiKey,appId,authDomain,projectId' && firebaseConfig.projectId === 'smoke-test');
    check('customer API responses prohibit caching', /no-store/.test(r.headers.get('cache-control') || ''));

    r = await fetch(`${BASE}/api/auth/config`);
    const adminAuthConfig = await r.json();
    check('admin auth config reports local email-code availability',
        r.status === 200 && adminAuthConfig.emailCodeAvailable === true);

    // ---- auth: passwordless flow ----
    r = await fetch(`${BASE}/api/orders`);
    check('orders list requires auth', r.status === 401, `status ${r.status}`);
    r = await fetch(`${BASE}/api/admin/customers`);
    check('admin customer directory requires auth', r.status === 401, `status ${r.status}`);

    // First sign-up bootstraps the owner and returns one-time recovery codes.
    r = await fetch(`${BASE}/api/admin/register`, json('POST', {
        full_name: 'Smoke Owner', email: 'owner@test.com', phone: '0241111111'
    }));
    const reg = await r.json();
    check('first sign-up becomes owner', r.status === 201 && reg.owner === true, `status ${r.status}`);
    check('owner receives recovery codes', Array.isArray(reg.recoveryCodes) && reg.recoveryCodes.length > 0);

    // Email OTP: request a code (captured from the console) and verify it.
    r = await fetch(`${BASE}/api/auth/request-code`, json('POST', { email: 'owner@test.com' }));
    check('request-code succeeds for active user', r.status === 200, `status ${r.status}`);
    check('sign-in code issued', /^\d{6}$/.test(lastOtp), `captured "${lastOtp}"`);

    r = await fetch(`${BASE}/api/auth/verify-code`, json('POST', { email: 'owner@test.com', code: '000000' === lastOtp ? '111111' : '000000' }));
    check('wrong code rejected', r.status === 400, `status ${r.status}`);

    r = await fetch(`${BASE}/api/auth/verify-code`, json('POST', { email: 'owner@test.com', code: lastOtp }));
    const login = await r.json();
    check('correct code issues session', r.status === 200 && !!login.accessToken, `status ${r.status}`);
    const auth = { 'Authorization': `Bearer ${login.accessToken}` };

    r = await fetch(`${BASE}/api/orders`, { headers: auth });
    check('orders list works with token', r.status === 200, `status ${r.status}`);

    r = await fetch(`${BASE}/api/suppliers`, { headers: auth });
    const initialSuppliers = await r.json();
    check('supplier directory starts without preview records', r.status === 200 && initialSuppliers.length === 0, `found ${initialSuppliers.length}`);

    r = await fetch(`${BASE}/api/admin/customers`, json('POST', {
        name: 'Walk-in Customer', phone: '0201002003', email: 'walkin@test.com',
        address: '12 Market Road', city: 'Kumasi', country: 'Ghana', customer_group: 'Retail'
    }, auth));
    const manualCustomer = await r.json();
    check('manager can add a shared customer record', r.status === 201 && manualCustomer.id > 0, `status ${r.status}`);
    r = await fetch(`${BASE}/api/admin/customers/${manualCustomer.id}`, json('PUT', {
        name: 'Walk-in Customer', phone: '0201002003', address: '14 Market Road',
        city: 'Kumasi', country: 'Ghana', customer_group: 'VIP', notes: '', status: 'active'
    }, auth));
    const updatedManualCustomer = await r.json();
    check('manager can update a shared customer record', r.status === 200 && updatedManualCustomer.customer_group === 'VIP' && updatedManualCustomer.address === '14 Market Road');
    r = await fetch(`${BASE}/api/admin/customers/${manualCustomer.id}/notes`, json('PATCH', { notes: 'Prefers WhatsApp updates.' }, auth));
    check('customer notes persist through the admin API', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/admin/customers`, { headers: auth });
    const sharedCustomers = await r.json();
    check('customer directory returns persisted records', r.status === 200 && sharedCustomers.some(customer => customer.id === manualCustomer.id && customer.notes === 'Prefers WhatsApp updates.'));

    r = await fetch(`${BASE}/api/suppliers`, json('POST', {
        supplier_name: 'Accra Kids Textiles', contact_person: 'Ama Mensah', email: 'ama@supplier.test',
        phone: '0203004005', business_address: 'North Industrial Area, Accra',
        products_supplied: 'Children clothing', status: 'active', notes: 'Smoke-test supplier'
    }, auth));
    const sharedSupplier = await r.json();
    check('manager can add a shared supplier record', r.status === 201 && sharedSupplier.id > 0, `status ${r.status}`);
    r = await fetch(`${BASE}/api/suppliers`, { headers: auth });
    const persistedSuppliers = await r.json();
    check('supplier directory returns persisted records', r.status === 200 && persistedSuppliers.some(supplier => supplier.id === sharedSupplier.id));
    r = await fetch(`${BASE}/api/admin/audit-log?limit=20`, { headers: auth });
    const earlyAudit = await r.json();
    check('admin mutations create a shared audit trail', r.status === 200 &&
        earlyAudit.some(entry => entry.entity_type === 'customer') &&
        earlyAudit.some(entry => entry.entity_type === 'supplier'));

    // ---- deterministic SKU backfill preserves manual assignments ----
    // Checkout now treats units held in pending/processing orders as reserved,
    // so the suite needs headroom on the product it orders from repeatedly.
    // The seed ships id 1 with stock 4; the run places ~31 units against it.
    // Stock assertions below are relative (before/after), so a higher floor is safe.
    await dbRun(`UPDATE products SET stock = 200 WHERE id = 1`);
    await dbRun(`UPDATE products SET sku = 'MANUAL-KEEP' WHERE id = 1`);
    await dbRun(`UPDATE products SET sku = NULL WHERE id = 2`);
    await new Promise(resolve => db.backfillMissingProductSkus(resolve));
    const skuRows = await Promise.all([dbGet(`SELECT sku FROM products WHERE id = 1`), dbGet(`SELECT sku FROM products WHERE id = 2`)]);
    check('SKU backfill preserves manually assigned SKU', skuRows[0].sku === 'MANUAL-KEEP', skuRows[0].sku);
    check('SKU backfill deterministically fills blank SKU', /^(CLO|SHO|ACC|NEW|BED|ESS|FEE|GEA|BAT)-\d{4}$/.test(skuRows[1].sku), skuRows[1].sku);
    const firstBackfill = skuRows[1].sku;
    await new Promise(resolve => db.backfillMissingProductSkus(resolve));
    check('SKU backfill is stable on rerun', (await dbGet(`SELECT sku FROM products WHERE id = 2`)).sku === firstBackfill);

    // ---- bulk image upload + transactional mapping ----
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=';
    async function uploadTiny() {
        const response = await fetch(`${BASE}/api/upload-image`, json('POST', { dataUrl: tinyPng }, auth));
        const body = await response.json();
        if (body.path) uploadedTestFiles.push(body.path);
        return { response, body };
    }
    const uploadA = await uploadTiny();
    const uploadB = await uploadTiny();
    check('product image upload returns server path', uploadA.response.status === 200 && /^images\/product_upload_/.test(uploadA.body.path || ''));
    r = await fetch(`${BASE}/api/products/bulk-images`, json('POST', { items: [{ id: 1, img: 'images/placeholder.svg' }] }, auth));
    check('bulk mapping rejects unsafe image path', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/products/bulk-images`, json('POST', { items: [{ id: 1, img: uploadA.body.path }, { id: 1, img: uploadB.body.path }] }, auth));
    check('bulk mapping rejects duplicate IDs', r.status === 400, `status ${r.status}`);
    const imageBeforeRollback = (await dbGet(`SELECT img FROM products WHERE id = 1`)).img;
    r = await fetch(`${BASE}/api/products/bulk-images`, json('POST', { items: [{ id: 1, img: uploadA.body.path }, { id: 999999, img: uploadB.body.path }] }, auth));
    check('bulk mapping rejects unknown products', r.status === 404, `status ${r.status}`);
    check('bulk mapping rollback leaves valid product unchanged', (await dbGet(`SELECT img FROM products WHERE id = 1`)).img === imageBeforeRollback);
    r = await fetch(`${BASE}/api/products/bulk-images`, json('POST', { items: [{ id: 1, img: uploadA.body.path }] }, auth));
    const bulkMapped = await r.json();
    check('bulk mapping updates valid item', r.status === 200 && bulkMapped.updated === 1, `status ${r.status}`);
    check('bulk mapping persists image path', (await dbGet(`SELECT img FROM products WHERE id = 1`)).img === uploadA.body.path);
    r = await fetch(`${BASE}/api/products/image-health`, { headers: auth });
    const health = await r.json();
    check('image health report includes all safeguards', r.status === 200 && ['missingImages','missingSkus','duplicateSkus','invalidPaths','unusedUploads'].every(k => Array.isArray(health[k])));


    // Recovery code is a valid backup sign-in, but only one concurrent request
    // may redeem it. This catches the race where both requests read the unused
    // row before either asynchronous UPDATE completes.
    const recoveryAttempts = await Promise.all([
        fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: reg.recoveryCodes[0] })),
        fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: reg.recoveryCodes[0] }))
    ]);
    const recoveryBodies = await Promise.all(recoveryAttempts.map((response) => response.json()));
    const recoverySuccesses = recoveryAttempts.filter((response) => response.status === 200).length;
    const recoveryRejections = recoveryAttempts.filter((response) => response.status === 400).length;
    const rec = recoveryBodies.find((body) => body && body.accessToken) || {};
    check('recovery code signs in once under concurrent use', recoverySuccesses === 1 && recoveryRejections === 1 && !!rec.accessToken,
        `statuses ${recoveryAttempts.map((response) => response.status).join(', ')}`);
    r = await fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: reg.recoveryCodes[0] }));
    check('consumed recovery code stays invalid', r.status === 400, `status ${r.status}`);

    r = await fetch(`${BASE}/api/admin/recovery-codes/status`);
    check('recovery-code status requires admin authentication', r.status === 401, `status ${r.status}`);
    r = await fetch(`${BASE}/api/admin/recovery-codes/status`, { headers: auth });
    const recoveryStatus = await r.json();
    check('authenticated admin sees remaining recovery-code count', r.status === 200 && recoveryStatus.remaining === 7,
        `status ${r.status}, remaining ${recoveryStatus.remaining}`);

    const loginClaims = jwt.decode(login.accessToken);
    const staleAdminToken = jwt.sign({
        id: loginClaims.id,
        username: loginClaims.username,
        role: loginClaims.role,
        iat: Math.floor(Date.now() / 1000) - (31 * 60)
    }, process.env.JWT_SECRET, { expiresIn: '12h' });
    r = await fetch(`${BASE}/api/admin/recovery-codes/regenerate`, json('POST', {}, {
        'Authorization': `Bearer ${staleAdminToken}`
    }));
    const staleRegeneration = await r.json();
    check('recovery-code regeneration requires a recent sign-in', r.status === 401 && staleRegeneration.code === 'reauth_required',
        `status ${r.status}, code ${staleRegeneration.code}`);

    r = await fetch(`${BASE}/api/admin/recovery-codes/regenerate`, json('POST', {}, auth));
    const regenerated = await r.json();
    check('authenticated admin can replace their recovery codes', r.status === 200 && regenerated.remaining === 8 &&
        Array.isArray(regenerated.recoveryCodes) && regenerated.recoveryCodes.length === 8, `status ${r.status}`);
    r = await fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: reg.recoveryCodes[1] }));
    check('regeneration invalidates every code from the previous set', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: regenerated.recoveryCodes[0] }));
    const regeneratedLogin = await r.json();
    check('a regenerated recovery code signs in once', r.status === 200 && !!regeneratedLogin.accessToken, `status ${r.status}`);

    // Unknown email gets a generic answer (no account enumeration).
    r = await fetch(`${BASE}/api/auth/request-code`, json('POST', { email: 'nobody@test.com' }));
    check('unknown email not revealed', r.status === 200, `status ${r.status}`);

    // Second sign-up is a pending staff request that cannot sign in yet.
    r = await fetch(`${BASE}/api/admin/register`, json('POST', {
        full_name: 'New Staff', email: 'staff@test.com'
    }));
    const reg2 = await r.json();
    check('second sign-up is pending staff', r.status === 201 && reg2.owner === false, `status ${r.status}`);
    r = await fetch(`${BASE}/api/auth/request-code`, json('POST', { email: 'staff@test.com' }));
    check('pending staff cannot request code', r.status === 403, `status ${r.status}`);

    // Owner adds a staff member directly (passwordless) — active immediately.
    r = await fetch(`${BASE}/api/users`, json('POST', { full_name: 'Direct Staff', email: 'direct@test.com', role: 'staff' }, auth));
    const created = await r.json();
    check('owner adds staff directly', r.status === 201 && created.id > 0, `status ${r.status}`);
    r = await fetch(`${BASE}/api/auth/request-code`, json('POST', { email: 'direct@test.com' }));
    check('new staff can request a sign-in code', r.status === 200, `status ${r.status}`);

    // Sign the new staff member in for real (OTP just requested above), so we
    // can prove their session dies the moment they're deleted.
    r = await fetch(`${BASE}/api/auth/verify-code`, json('POST', { email: 'direct@test.com', code: lastOtp }));
    const staffLogin = await r.json();
    check('direct staff can sign in', r.status === 200 && !!staffLogin.accessToken, `status ${r.status}`);

    // Deleting a user must also remove their sign-in code rows (FK) — this
    // exact case used to fail with "FOREIGN KEY constraint failed".
    r = await fetch(`${BASE}/api/users/${created.id}`, { method: 'DELETE', headers: auth });
    check('staff with sign-in codes deletable', r.status === 200, `status ${r.status}`);

    // Their still-unexpired JWT must be dead immediately (per-request re-check).
    r = await fetch(`${BASE}/api/orders`, { headers: { 'Authorization': `Bearer ${staffLogin.accessToken}` } });
    check('deleted staff token revoked instantly', r.status === 403, `status ${r.status}`);

    // ---- guest checkout: retail, server-side total ----
    // Expected totals derive from the seeded product so the test tracks the
    // catalogue: managed sizes win, otherwise base price (+0 modifier size).
    const p1 = products.find(p => p.id === 1);
    let managed = null;
    try { const arr = JSON.parse(p1.sizes); if (Array.isArray(arr) && arr.length) managed = arr; } catch (e) { /* no managed sizes → base price path */ }
    const sizeLabel = managed ? managed[0].label : '6M';
    const unitRetail = managed ? (managed[0].price != null ? managed[0].price : p1.price) : p1.price;

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Smoke Test', customer_phone: '0241234567',
        order_type: 'retail', items: [{ id: 1, quantity: 2, size: sizeLabel }]
    }));
    const order = await r.json();
    check('guest checkout creates order', r.status === 200 && order.success === true);
    check('order number assigned', /^ORD-\d+$/.test(order.order_number || ''), order.order_number);
    check(`retail total = unit x 2 (${unitRetail} x 2)`, close(order.total_amount, unitRetail * 2), `got ${order.total_amount}`);
    r = await fetch(`${BASE}/api/analytics/sales?period=week`, { headers: auth });
    const pendingAnalytics = await r.json();
    check('pending WhatsApp orders are excluded from recognized revenue',
        r.status === 200 && Number(pendingAnalytics.kpis.totalRevenue || 0) === 0,
        `got ${pendingAnalytics.kpis && pendingAnalytics.kpis.totalRevenue}`);

    // ---- Paystack direct checkout and shared webhook router ----
    r = await fetch(`${BASE}/api/payments/paystack/config`);
    const publicPaystackConfig = await r.json();
    check('Paystack availability and Akua routing are public without exposing keys',
        r.status === 200 && publicPaystackConfig.enabled === true && publicPaystackConfig.akua_forwarding === true &&
        !publicPaystackConfig.secret && !publicPaystackConfig.webhook_url);
    r = await fetch(`${BASE}/api/checkout/paystack`, json('POST', {
        customer_name: 'Direct Guest', customer_phone: '0249000000', customer_email: '',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    check('Paystack checkout requires email and full address', r.status === 400, `status ${r.status}`);

    const directPayload = {
        customer_name: 'Direct Guest', customer_phone: '0249000000', customer_email: 'direct@test.com',
        order_type: 'retail', amount: 1,
        delivery_address: { line1: '10 Test Avenue', city: 'Kasoa', region: 'Central Region', landmark: 'Near the market' },
        items: [{ id: 1, quantity: 1, size: sizeLabel }]
    };
    r = await fetch(`${BASE}/api/checkout/paystack`, json('POST', directPayload));
    const directOrder = await r.json();
    check('guest Paystack checkout initializes', r.status === 200 && /^DCK-\d+-[a-f0-9]{20}$/.test(directOrder.reference || ''));
    check('Paystack amount is server-calculated in pesewas', Number(paystackInitializePayload.amount) === Math.round(unitRetail * 100), `got ${paystackInitializePayload && paystackInitializePayload.amount}`);
    const directDbOrder = await dbGet('SELECT * FROM orders WHERE order_number = ?', [directOrder.order_number]);
    check('Paystack order stores address snapshot before payment', directDbOrder.status === 'awaiting_payment' && directDbOrder.delivery_address_line1 === '10 Test Avenue' && directDbOrder.customer_email === 'direct@test.com');

    r = await postPaystackWebhook({ event: 'charge.success', data: { reference: directOrder.reference } }, 'bad-signature');
    check('Paystack webhook rejects invalid signature', r.status === 401, `status ${r.status}`);
    r = await postPaystackWebhook({ event: 'charge.success', data: {
        id: 1001, reference: directOrder.reference, status: 'success', amount: 1, currency: 'GHS', channel: 'card',
        metadata: { source_app: 'dckids', order_number: directOrder.order_number }
    }});
    check('Paystack amount mismatch is acknowledged for manual review', r.status === 200, `status ${r.status}`);
    check('mismatched Paystack order is not marked paid', (await dbGet('SELECT status FROM orders WHERE id = ?', [directDbOrder.id])).status === 'payment_review');

    r = await fetch(`${BASE}/api/checkout/paystack`, json('POST', Object.assign({}, directPayload, { customer_email: 'paid@test.com' })));
    const paidOrder = await r.json();
    const paidDbOrder = await dbGet('SELECT * FROM orders WHERE order_number = ?', [paidOrder.order_number]);
    const stockBeforePayment = (await dbGet('SELECT stock FROM products WHERE id = 1')).stock;
    const successEvent = { event: 'charge.success', data: {
        id: 1002, reference: paidOrder.reference, status: 'success', amount: Math.round(unitRetail * 100), currency: 'GHS',
        channel: 'mobile_money', gateway_response: 'Successful', paid_at: new Date().toISOString(),
        metadata: { source_app: 'dckids', order_number: paidOrder.order_number }
    }};
    r = await postPaystackWebhook(successEvent);
    check('signed Paystack success marks the order paid', r.status === 200 && (await dbGet('SELECT status FROM orders WHERE id = ?', [paidDbOrder.id])).status === 'paid');
    r = await fetch(`${BASE}/api/analytics/sales?period=week`, { headers: auth });
    const paidAnalytics = await r.json();
    check('verified Paystack payment appears in recognized revenue',
        r.status === 200 && close(Number(paidAnalytics.kpis.totalRevenue || 0), unitRetail),
        `got ${paidAnalytics.kpis && paidAnalytics.kpis.totalRevenue}`);
    const stockAfterPayment = (await dbGet('SELECT stock FROM products WHERE id = 1')).stock;
    check('successful Paystack payment deducts stock once', stockAfterPayment === Math.max(0, stockBeforePayment - 1), `${stockBeforePayment} -> ${stockAfterPayment}`);
    r = await postPaystackWebhook(successEvent);
    check('duplicate Paystack webhook is idempotent', r.status === 200 && (await dbGet('SELECT stock FROM products WHERE id = 1')).stock === stockAfterPayment);
    check('owner receives one itemized paid-order email', ownerPaymentEmails === 1, `got ${ownerPaymentEmails}`);
    r = await fetch(`${BASE}/api/payments/paystack/status/${paidOrder.reference}`);
    const paidStatus = await r.json();
    check('payment status endpoint returns no PII', r.status === 200 && paidStatus.payment_status === 'paid' && !paidStatus.customer_email && !paidStatus.items);

    const legacyEvent = { event: 'charge.success', data: { reference: 'OTHER-APP-123', status: 'success', amount: 5000, currency: 'GHS' } };
    const akuaEvent = { event: 'charge.success', data: {
        reference: 'AKUA-1786580096715-b599fee8fef6', status: 'success', amount: 2200, currency: 'GHS',
        metadata: { source_app: 'akua_inventory', sale_id: 'sale-smoke' }
    }};
    const akuaRaw = JSON.stringify(akuaEvent);
    const akuaSignature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(akuaRaw).digest('hex');
    r = await postPaystackWebhook(akuaEvent);
    const akuaForwardResult = await r.json();
    check('AKUA webhook is routed to its isolated destination',
        r.status === 200 && akuaForwardResult.destination === 'akua' && forwardedWebhookBody === '');
    check('AKUA forwarding preserves raw body and Paystack signature',
        forwardedAkuaWebhookBody === akuaRaw && forwardedAkuaWebhookSignature === akuaSignature);
    akuaForwardingShouldFail = true;
    r = await postPaystackWebhook(akuaEvent);
    check('AKUA forwarding failure remains retriable', r.status === 500 || r.status === 502, `status ${r.status}`);
    akuaForwardingShouldFail = false;

    r = await postPaystackWebhook(legacyEvent);
    const legacyForwardResult = await r.json();
    check('non-DCK and non-AKUA webhook keeps legacy forwarding unchanged',
        r.status === 200 && legacyForwardResult.destination === 'legacy' && forwardedWebhookBody === JSON.stringify(legacyEvent));
    forwardingShouldFail = true;
    r = await postPaystackWebhook(legacyEvent);
    check('legacy forwarding failure remains retriable', r.status === 500 || r.status === 502, `status ${r.status}`);
    forwardingShouldFail = false;

    // ---- Firebase customer identity and protected account data ----
    const customerAuth = { 'Authorization': 'Bearer verified-new' };
    const secondCustomerAuth = { 'Authorization': 'Bearer verified-second' };
    r = await fetch(`${BASE}/api/customer/me`);
    check('customer profile requires a bearer token', r.status === 401, `status ${r.status}`);
    for (const token of ['expired', 'malformed']) {
        r = await fetch(`${BASE}/api/customer/session`, json('POST', {}, { 'Authorization': `Bearer ${token}` }));
        check(`${token} Firebase token is rejected`, r.status === 401, `status ${r.status}`);
    }
    r = await fetch(`${BASE}/api/customer/session`, json('POST', {}, { 'Authorization': 'Bearer unverified' }));
    check('unverified Firebase email cannot provision an account', r.status === 403, `status ${r.status}`);

    r = await fetch(`${BASE}/api/customer/session`, json('POST', { phone: '0243333333' }, customerAuth));
    const customerSession = await r.json();
    check('verified Firebase identity provisions a customer', r.status === 200 && customerSession.created === true && customerSession.customer.email === 'new.customer@test.com');
    const customerId = customerSession.customer.id;
    r = await fetch(`${BASE}/api/customer/session`, json('POST', {}, customerAuth));
    const repeatedSession = await r.json();
    check('customer session provisioning is idempotent', r.status === 200 && repeatedSession.created === false && repeatedSession.customer.id === customerId);
    r = await fetch(`${BASE}/api/customer/session`, json('POST', {}, { 'Authorization': 'Bearer verified-conflict' }));
    check('conflicting verified identity is rejected', r.status === 409, `status ${r.status}`);

    r = await fetch(`${BASE}/api/customer/me`, { headers: customerAuth });
    const initialProfile = await r.json();
    check('verified customer can read profile', r.status === 200 && initialProfile.id === customerId);
    r = await fetch(`${BASE}/api/customer/me`, json('PUT', { name: 'Updated Customer', phone: '0244444444', email: 'changed@test.com' }, customerAuth));
    const updatedProfile = await r.json();
    check('profile updates name and phone', r.status === 200 && updatedProfile.customer.name === 'Updated Customer' && updatedProfile.customer.phone === '0244444444');
    check('profile email is immutable', updatedProfile.customer.email === 'new.customer@test.com');
    r = await fetch(`${BASE}/api/admin/customers`, { headers: auth });
    const accountDirectory = await r.json();
    check('Firebase account profile is synchronized into the admin directory', r.status === 200 && accountDirectory.some(customer =>
        customer.customer_account_id === customerId && customer.registered_account === 1 &&
        customer.name === 'Updated Customer' && customer.phone === '0244444444' && customer.email === 'new.customer@test.com'));
    r = await fetch(`${BASE}/api/customer/me`, json('PUT', { name: 'X', phone: '024' }, customerAuth));
    check('profile validation rejects short names', r.status === 400, `status ${r.status}`);

    r = await fetch(`${BASE}/api/wishlist/merge`, json('POST', { productIds: [1, 2, 1] }, customerAuth));
    const firstMerge = await r.json();
    check('wishlist merge creates a validated union', r.status === 200 && firstMerge.productIds.includes(1) && firstMerge.productIds.includes(2));
    r = await fetch(`${BASE}/api/wishlist/merge`, json('POST', { productIds: [2, 1] }, customerAuth));
    const secondMerge = await r.json();
    check('wishlist merge is idempotent', r.status === 200 && secondMerge.productIds.length === 2);
    r = await fetch(`${BASE}/api/wishlist/merge`, json('POST', { productIds: [999999] }, customerAuth));
    check('wishlist merge rejects unknown products', r.status === 400, `status ${r.status}`);

    r = await fetch(`${BASE}/api/customer/addresses`, json('POST', {
        label: 'Home', recipient_name: 'Updated Customer', phone: '0244444444',
        address_line1: '1 Test Street', city: 'Accra', region: 'Greater Accra', is_default: true
    }, customerAuth));
    const address = await r.json();
    check('customer can save a delivery address', r.status === 200 && address.id > 0);
    r = await fetch(`${BASE}/api/customer/session`, json('POST', {}, secondCustomerAuth));
    check('second verified identity provisions separately', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/customer/addresses/${address.id}`, { method: 'DELETE', headers: secondCustomerAuth });
    check('address ownership prevents cross-account deletion', r.status === 404, `status ${r.status}`);

    r = await fetch(`${BASE}/api/products/1/reviews`, json('POST', {
        rating: 4, title: 'Account review', body: 'Linked to the signed-in customer.'
    }, customerAuth));
    check('signed-in review is accepted', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/customer/reviews`, { headers: customerAuth });
    const customerReviews = await r.json();
    check('signed-in review is attributed to the customer', r.status === 200 && customerReviews.some(review => review.title === 'Account review'));

    r = await fetch(`${BASE}/api/customer/orders`, { headers: customerAuth });
    const ordersBeforeCustomerCheckout = await r.json();
    check('guest order remains unowned', r.status === 200 && !ordersBeforeCustomerCheckout.some(item => item.order_number === order.order_number));
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Updated Customer', customer_phone: '0244444444',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }, customerAuth));
    const customerOrder = await r.json();
    check('authenticated checkout creates an order', r.status === 200 && customerOrder.success === true);
    r = await fetch(`${BASE}/api/customer/orders`, { headers: customerAuth });
    const customerOrders = await r.json();
    check('authenticated order is attached with its items', r.status === 200 && customerOrders.some(item => item.order_number === customerOrder.order_number && item.items.length === 1));
    r = await fetch(`${BASE}/api/checkout/paystack`, json('POST', {
        customer_name: 'Updated Customer', customer_phone: '0244444444', customer_email: 'spoofed@test.com',
        order_type: 'retail', delivery_address: { line1: '1 Test Street', city: 'Accra', region: 'Greater Accra' },
        items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }, customerAuth));
    const signedInDirectOrder = await r.json();
    const signedInDirectDb = await dbGet('SELECT customer_account_id, customer_email FROM orders WHERE order_number = ?', [signedInDirectOrder.order_number]);
    check('signed-in Paystack order uses verified account identity', r.status === 200 && signedInDirectDb.customer_account_id === customerId && signedInDirectDb.customer_email === 'new.customer@test.com');
    const orderCountBeforeInvalidToken = (await dbGet(`SELECT COUNT(*) AS count FROM orders`)).count;
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Invalid Token', customer_phone: '0245555555',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }, { 'Authorization': 'Bearer malformed' }));
    check('invalid bearer token cannot downgrade to guest checkout', r.status === 401, `status ${r.status}`);
    check('invalid bearer token creates no order', (await dbGet(`SELECT COUNT(*) AS count FROM orders`)).count === orderCountBeforeInvalidToken);

    // A verified email links a legacy record once, preserving account data and
    // claiming only the historical orders that matched its stored phone then.
    const legacyInsert = await dbRun(
        `INSERT INTO customer_accounts (email, phone, name, password_hash) VALUES (?, ?, ?, ?)`,
        ['legacy.customer@test.com', '0551234567', 'Legacy Customer', 'retired-hash']
    );
    await dbRun(`INSERT INTO customer_addresses (customer_id, label, address_line1, city, is_default) VALUES (?, ?, ?, ?, 1)`, [legacyInsert.lastID, 'Legacy Home', 'Old Road', 'Kumasi']);
    await dbRun(`INSERT INTO wishlist_items (customer_id, product_id) VALUES (?, ?)`, [legacyInsert.lastID, 1]);
    await dbRun(`INSERT INTO product_reviews (product_id, customer_id, author_name, rating, body) VALUES (?, ?, ?, ?, ?)`, [1, legacyInsert.lastID, 'Legacy Customer', 5, 'Preserved legacy review']);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Legacy Customer', customer_phone: '0551234567',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const legacyOrder = await r.json();
    r = await fetch(`${BASE}/api/customer/session`, json('POST', {}, { 'Authorization': 'Bearer verified-legacy' }));
    const legacySession = await r.json();
    check('verified email links its legacy account', r.status === 200 && legacySession.linkedLegacy === true && legacySession.customer.id === legacyInsert.lastID);
    r = await fetch(`${BASE}/api/customer/orders`, { headers: { 'Authorization': 'Bearer verified-legacy' } });
    const linkedLegacyOrders = await r.json();
    check('legacy order phone match is backfilled once', linkedLegacyOrders.some(item => item.order_number === legacyOrder.order_number));
    r = await fetch(`${BASE}/api/wishlist`, { headers: { 'Authorization': 'Bearer verified-legacy' } });
    check('legacy wishlist survives linking', r.status === 200 && (await r.json()).some(item => item.product_id === 1));
    r = await fetch(`${BASE}/api/customer/me`, json('PUT', { name: 'Legacy Customer', phone: '0509999999' }, { 'Authorization': 'Bearer verified-legacy' }));
    check('linked customer can later change phone', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Someone Else', customer_phone: '0509999999',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const laterPhoneOrder = await r.json();
    await fetch(`${BASE}/api/customer/session`, json('POST', {}, { 'Authorization': 'Bearer verified-legacy' }));
    r = await fetch(`${BASE}/api/customer/orders`, { headers: { 'Authorization': 'Bearer verified-legacy' } });
    check('later phone changes never claim unrelated orders', !(await r.json()).some(item => item.order_number === laterPhoneOrder.order_number));

    // ---- wholesale: per-piece discount, MOQ floor ----
    const settings = await (await fetch(`${BASE}/api/settings`)).json();
    check('store settings use evergreen preorder messaging',
        settings.banner_text === 'China Pre-Orders are open! Message us on WhatsApp for the current closing date.');
    const moq = settings.wholesale_moq;
    const disc = settings.wholesale_discount;
    const unitWs = Math.round(unitRetail * (1 - disc / 100) * 100) / 100;

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: 1, quantity: moq, size: sizeLabel }]
    }));
    const wsOrder = await r.json();
    check(`wholesale total = discounted unit x MOQ (${unitWs} x ${moq})`,
        r.status === 200 && close(wsOrder.total_amount, unitWs * moq), `got ${wsOrder.total_amount}`);

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: 1, quantity: moq - 1, size: sizeLabel }]
    }));
    check('wholesale below MOQ rejected', r.status === 400, `status ${r.status}`);

    // ---- China pre-orders: paid in full up front, three kinds ----
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Pre Buyer', customer_phone: '0243333333',
        order_type: 'preorder', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const preOrder = await r.json();
    const preRow = await dbGet('SELECT id, status, preorder_kind FROM orders WHERE order_number = ?', [preOrder.order_number]);
    check('pre-orders start awaiting full payment, not a deposit',
        r.status === 200 && preOrder.status === 'awaiting_payment' && preRow.status === 'awaiting_payment', `got ${preOrder.status}`);
    check('a shop pre-order without a kind is a DC Kids pick', preRow.preorder_kind === 'shop', `got ${preRow.preorder_kind}`);

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Pre Reseller', customer_phone: '0243333334',
        order_type: 'preorder', preorder_kind: 'bulk', items: [{ id: 1, quantity: moq, size: sizeLabel }]
    }));
    const bulkPre = await r.json();
    check(`a bulk pre-order is priced as wholesale (${unitWs} x ${moq})`,
        r.status === 200 && close(bulkPre.total_amount, unitWs * moq), `got ${bulkPre.total_amount}`);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Pre Reseller', customer_phone: '0243333334',
        order_type: 'preorder', preorder_kind: 'bulk', items: [{ id: 1, quantity: moq - 1, size: sizeLabel }]
    }));
    check('a bulk pre-order below the MOQ is rejected', r.status === 400, `status ${r.status}`);

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Retail Kind', customer_phone: '0243333335',
        order_type: 'retail', preorder_kind: 'bulk', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const retailWithKind = await r.json();
    const retailKindRow = await dbGet('SELECT id, preorder_kind FROM orders WHERE order_number = ?', [retailWithKind.order_number]);
    check('a pre-order kind sent on a retail order is ignored', retailKindRow.preorder_kind === null, `got ${retailKindRow.preorder_kind}`);

    r = await fetch(`${BASE}/api/orders/track`, json('POST', { order_number: preOrder.order_number, phone: '0243333333' }));
    const trackedPre = await r.json();
    check('tracking returns the payment method and kind the receipt shows',
        r.status === 200 && trackedPre.payment_method === 'WhatsApp' && trackedPre.preorder_kind === 'shop');

    r = await fetch(`${BASE}/api/orders/${preRow.id}/preorder-kind`, json('PATCH', { preorder_kind: 'personal' }));
    check('tagging a pre-order kind needs a staff sign-in', r.status === 401 || r.status === 403, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders/${preRow.id}/preorder-kind`, json('PATCH', { preorder_kind: 'gift' }, auth));
    check('an unknown pre-order kind is rejected', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders/${retailKindRow.id}/preorder-kind`, json('PATCH', { preorder_kind: 'personal' }, auth));
    check('only pre-orders can be given a pre-order kind', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders/${preRow.id}/preorder-kind`, json('PATCH', { preorder_kind: 'personal' }, auth));
    check('staff can tag a pre-order as personal',
        r.status === 200 && (await dbGet('SELECT preorder_kind FROM orders WHERE id = ?', [preRow.id])).preorder_kind === 'personal');

    // ---- checkout validation ----
    const badOrders = [
        ['negative quantity', { items: [{ id: 1, quantity: -5 }] }],
        ['huge quantity', { items: [{ id: 1, quantity: 5000 }] }],
        ['non-integer quantity', { items: [{ id: 1, quantity: 1.5 }] }],
        ['invalid product id', { items: [{ id: 'abc', quantity: 1 }] }],
        ['too many items', { items: Array.from({ length: 51 }, () => ({ id: 1, quantity: 1 })) }],
        ['empty items', { items: [] }]
    ];
    for (const [name, body] of badOrders) {
        r = await fetch(`${BASE}/api/orders`, json('POST', Object.assign({
            customer_name: 'X', customer_phone: '024', order_type: 'retail'
        }, body)));
        check(`checkout rejects ${name}`, r.status === 400, `status ${r.status}`);
    }

    // ---- order tracking ----
    r = await fetch(`${BASE}/api/orders/track`, json('POST', { order_number: order.order_number, phone: '0241234567' }));
    check('tracking works with matching phone', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders/track`, json('POST', { order_number: order.order_number, phone: '0209999999' }));
    check('tracking rejects wrong phone', r.status === 403, `status ${r.status}`);

    // ---- order status whitelist ----
    const orders = await (await fetch(`${BASE}/api/orders`, { headers: auth })).json();
    const dbId = orders[0].id;
    r = await fetch(`${BASE}/api/orders/${dbId}`, json('PUT', { status: 'not-a-status' }, auth));
    check('status update rejects unknown status', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders/${dbId}`, json('PUT', { status: 'paid' }, auth));
    check('status update accepts paid', r.status === 200, `status ${r.status}`);

    // ---- reviews validation ----
    r = await fetch(`${BASE}/api/products/1/reviews`, json('POST', {
        rating: 5, body: 'Great quality, my son loves it!', author_name: 'Smoke Test'
    }));
    check('review submits', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/products/1/reviews`, json('POST', { rating: 9, body: 'rating out of range' }));
    check('review rejects rating > 5', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/products/1/reviews`, json('POST', { rating: 5, body: 'x'.repeat(2001) }));
    check('review rejects oversized body', r.status === 400, `status ${r.status}`);

    // ---- retired local customer passwords ----
    r = await fetch(`${BASE}/api/customer/register`, json('POST', { name: 'X', email: 'x@x.com', password: 'longenough1' }));
    check('local customer register is permanently retired', r.status === 404 || r.status === 410, `status ${r.status}`);

    // ---- malformed JSON ----
    r = await fetch(`${BASE}/api/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json'
    });
    check('malformed JSON returns 400', r.status === 400, `status ${r.status}`);

    // An unclosed <div> in admin.html once nested every modal declared after
    // the receipt inside a display:none container, so they could be opened
    // but never seen. Nothing caught it, because each modal's own display
    // property still read "flex". Balance is the cheap proxy for that.
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    const divOpens = (adminHtml.match(/<div[\s>]/g) || []).length;
    const divCloses = (adminHtml.match(/<\/div>/g) || []).length;
    check('admin.html closes every div it opens', divOpens === divCloses,
        `${divOpens} opened, ${divCloses} closed`);

    // --- Order source ---
    // The dashboard ranks these, so the column has to hold one of a known set
    // rather than whatever the caller typed.
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Source Known', customer_phone: '0249000101',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }],
        source: 'Instagram'
    }));
    const knownSource = (await r.json()).order_number;

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Source Junk', customer_phone: '0249000102',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }],
        source: 'carrier pigeon'
    }));
    check('an unrecognised source does not block the sale', r.status === 200, `status ${r.status}`);
    const junkSource = (await r.json()).order_number;

    const sourceRows = await (await fetch(`${BASE}/api/orders`, { headers: auth })).json();
    const findSource = (number) => (sourceRows.find((o) => o.order_number === number) || {}).source;
    check('a recognised source is stored, lowercased', findSource(knownSource) === 'instagram', String(findSource(knownSource)));
    // A guest order carrying nonsense still came through the storefront, so the
    // fallback is right. What must never happen is the nonsense being stored.
    const allowedSources = ['instagram', 'whatsapp', 'tiktok', 'facebook', 'referral', 'walk-in', 'storefront'];
    check('an unrecognised source never reaches the column',
        allowedSources.indexOf(findSource(junkSource)) !== -1, String(findSource(junkSource)));
    check('an order placed without a source is recorded as the storefront',
        findSource(order.order_number) === 'storefront', String(findSource(order.order_number)));

    // --- Payments ---
    // Takings are not order totals: an order can be worth money nobody paid,
    // so this endpoint reads the payments table and must stay authenticated.
    r = await fetch(`${BASE}/api/admin/payments`);
    check('payments require a signed-in admin', r.status === 401 || r.status === 403, `status ${r.status}`);

    r = await fetch(`${BASE}/api/admin/payments?period=30`, { headers: auth });
    check('payments endpoint answers for a period', r.status === 200, `status ${r.status}`);
    const payBody = await r.json();
    check('payments reply carries rows, a summary and a method split',
        Array.isArray(payBody.payments) && !!payBody.summary && Array.isArray(payBody.by_method),
        Object.keys(payBody).join(','));
    check('the summary average agrees with its own total and count',
        payBody.summary.count === 0
            ? payBody.summary.average === 0
            : Math.abs(payBody.summary.average - (payBody.summary.received / payBody.summary.count)) < 0.01,
        JSON.stringify(payBody.summary));
    check('still-owed counts the unpaid open orders', Number(payBody.summary.still_owed) >= 0,
        String(payBody.summary.still_owed));

    // --- Content-Security-Policy ---
    // The admin's "Continue with Google" button only renders once
    // GOOGLE_CLIENT_ID is set, so a policy missing the Google Identity origins
    // looks healthy on a dev box and fails only in production. These assert the
    // allowlist directly rather than the button.
    const adminCsp = (await fetch(`${BASE}/admin.html`)).headers.get('content-security-policy') || '';
    check('admin CSP allows the Google Identity script',
        adminCsp.includes('https://accounts.google.com/gsi/client'), adminCsp);
    check('admin CSP allows the Google Identity frame',
        /frame-src[^;]*https:\/\/accounts\.google\.com\/gsi\//.test(adminCsp), adminCsp);
    check('admin CSP allows the Google Identity endpoints',
        /connect-src[^;]*https:\/\/accounts\.google\.com\/gsi\//.test(adminCsp), adminCsp);
    check('admin CSP allows the Google Identity stylesheet',
        adminCsp.includes('https://accounts.google.com/gsi/style'), adminCsp);

    // A directive repeated inside one policy is ignored after the first
    // occurrence, so a duplicate silently drops whichever copy came second.
    check('admin CSP declares each directive once',
        ['script-src', 'style-src', 'connect-src', 'frame-src', 'img-src', 'default-src']
            .every(d => (adminCsp.match(new RegExp('(^|; )' + d + ' ', 'g')) || []).length === 1), adminCsp);

    const storeCsp = (await fetch(`${BASE}/index.html`)).headers.get('content-security-policy') || '';
    check('storefront CSP allows the Firebase SDK origin',
        storeCsp.includes('https://www.gstatic.com'), storeCsp);
    check('storefront CSP keeps its own style-src',
        /style-src[^;]*'unsafe-inline'/.test(storeCsp), storeCsp);

    // Both surfaces must still refuse arbitrary third-party script.
    check('no CSP allows a wildcard script source',
        !/script-src[^;]*\*/.test(adminCsp) && !/script-src[^;]*\*/.test(storeCsp),
        `admin: ${adminCsp} | store: ${storeCsp}`);


    // ---- WhatsApp updates -------------------------------------------------
    // admin.js runs in a browser, so the pure helpers are lifted out and run
    // in a vm here. They decide what a customer is told and which number the
    // message opens against, which is worth pinning down.
    const vm = require('vm');
    // adminSource is already read above.
    const waStart = adminSource.indexOf('function normalizeGhPhone');
    const waEnd = adminSource.indexOf('function openWhatsAppUpdate');
    check('admin.js still carries the WhatsApp helpers', waStart !== -1 && waEnd > waStart);

    const wa = { formatNumber: (n) => Number(n).toFixed(2) };
    vm.createContext(wa);
    vm.runInContext(adminSource.slice(waStart, waEnd), wa);

    // A Ghanaian number is written several ways; wa.me only accepts one.
    const phoneForms = ['0241234567', '024 123 4567', '+233 24 123 4567', '233241234567', '241234567'];
    check('every written form of a Ghana number normalizes to one international number',
        phoneForms.every(form => wa.normalizeGhPhone(form) === '233241234567'));
    check('a number that cannot be dialled normalizes to null',
        ['12345', '', null, undefined, 'not a phone'].every(bad => wa.normalizeGhPhone(bad) === null));
    check('the WhatsApp link carries the international number and the encoded text',
        wa.whatsappLink('0241234567', 'Hi there') === 'https://wa.me/233241234567?text=Hi%20there');
    check('a local number is never handed to wa.me as written',
        !wa.whatsappLink('0241234567', 'x').includes('wa.me/024'));

    // What is still owed drives whether the message mentions money at all.
    check('the balance is the total less what has been paid',
        wa.orderBalanceDue({ total: 450, amount_paid: 100 }) === 350);
    check('an overpaid or settled order owes nothing rather than a negative',
        wa.orderBalanceDue({ total: 100, amount_paid: 250 }) === 0);

    const owing = { customer: 'Akua Mensah', order_number: 'ORD-10001', total: 450, amount_paid: 100 };
    const settled = { customer: 'Akua Mensah', order_number: 'ORD-10001', total: 450, amount_paid: 450 };
    check('a message about an unpaid order states the balance',
        wa.buildOrderMessage(Object.assign({}, owing, { status: 'awaiting_payment' })).includes('350'));
    check('a message about a settled order does not mention a balance',
        !wa.buildOrderMessage(Object.assign({}, settled, { status: 'shipped' })).includes('Balance'));
    check('a delivered order is never asked for money',
        !wa.buildOrderMessage(Object.assign({}, owing, { status: 'delivered' })).includes('Balance'));
    check('the message opens with the customer first name',
        wa.buildOrderMessage(Object.assign({}, owing, { status: 'paid' })).startsWith('Hi Akua,'));
    check('a customer with no name on the order is still greeted',
        wa.buildOrderMessage({ status: 'paid', order_number: 'X', total: 0 }).startsWith('Hi there,'));
    check('every order status writes its own message',
        new Set(['pending', 'pending_deposit', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled']
            .map(status => wa.buildOrderMessage(Object.assign({}, owing, { status })))).size === 8);
    check('an unknown status still produces a message rather than undefined',
        typeof wa.buildOrderMessage(Object.assign({}, owing, { status: 'something_new' })) === 'string');
    check('every message is signed with the shop name',
        ['pending', 'paid', 'delivered', 'cancelled']
            .every(status => wa.buildOrderMessage(Object.assign({}, owing, { status })).endsWith('DC Kids Brand')));

    // The launch screen's layers have to exist, or it plays to an empty black screen.
    const splashLayers = ['dc', 'mark', 'tagline'];
    check('every launch screen layer is on disk',
        splashLayers.every(name => fs.existsSync(path.join(__dirname, '..', 'brand', `splash-${name}.webp`))));
    const adminHtmlForSplash = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    check('the admin references each launch screen layer',
        splashLayers.every(name => adminHtmlForSplash.includes(`brand/splash-${name}.webp`)));
    const swForSplash = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    check('the service worker precaches the launch screen, so a return visit paints it at once',
        splashLayers.every(name => swForSplash.includes(`/brand/splash-${name}.webp`)));
    check('motion is resolved before first paint, not left to the stylesheet alone',
        adminHtmlForSplash.includes('data-motion') && adminHtmlForSplash.includes('dck-splash-seen'));

    console.log(`\n${passed} passed, ${failed} failed`);
    cleanupDb();
    process.exit(failed ? 1 : 0);
}

run().catch(err => {
    console.error('FATAL:', err);
    cleanupDb();
    process.exit(1);
});
