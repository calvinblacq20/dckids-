// Smoke tests: boots the real server on a throwaway port + database and
// exercises the critical paths end-to-end. Run with `npm test` from server/.
// No test framework — plain assertions, exit 1 on any failure — so it runs
// anywhere Node runs, including a fresh clone with only `npm install` done.
const fs = require('fs');
const path = require('path');

const TEST_PORT = 3041;
const TEST_DATA_DIR = path.join(__dirname, '_smoketest_data');
const TEST_DB = path.join(TEST_DATA_DIR, 'inventory.db');
const BASE = `http://localhost:${TEST_PORT}`;

// Set (not delete) every env var the server reads: dotenv loads server/.env at
// require time but never overrides variables that are already set, so explicit
// values here insulate the test from whatever the operator has in .env.
process.env.PORT = String(TEST_PORT);
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DB_PATH = TEST_DB;
process.env.BACKUP_SCHEDULE_DISABLED = 'true';
process.env.NODE_ENV = 'test';              // dev mode: localhost bypasses rate limits
process.env.RESEND_API_KEY = '';            // emails log to console instead of sending
process.env.OWNER_EMAIL = 'owner@test.com'; // the test's first sign-up is the owner

let passed = 0;
let failed = 0;
const uploadedTestFiles = [];
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

function cleanupDb() {
    const resolved = path.resolve(TEST_DATA_DIR);
    if (path.dirname(resolved) !== path.resolve(__dirname) || path.basename(resolved) !== '_smoketest_data') {
        throw new Error('Refusing to clean an unexpected test data directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
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
    const runtime = require('./server'); // boots on TEST_PORT against TEST_DB
    const db = require('./db');
    const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params || [], function(err) { err ? reject(err) : resolve(this); }));
    const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row)));

    const up = await waitForServer(30);
    if (!up) { console.error('FATAL: server did not start'); process.exit(1); }

    let healthResponse = await fetch(`${BASE}/api/health`);
    const runtimeHealth = await healthResponse.json();
    check('health reports database and storage ready', healthResponse.status === 200 && runtimeHealth.status === 'ok' && runtimeHealth.database === 'ok' && runtimeHealth.storage === 'ok');

    // ---- fresh-database boot: seeded from the products.json snapshot ----
    const products = await (await fetch(`${BASE}/api/products`)).json();
    check('fresh DB seeds full catalogue', Array.isArray(products) && products.length >= 200, `got ${products.length}`);
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
    check('service worker image failure returns SVG placeholder', swSource.includes("isImage ? caches.match('/images/placeholder.svg')"));

    // ---- static frontend ----
    for (const page of ['/', '/admin.html', '/track.html']) {
        const r = await fetch(`${BASE}${page}`);
        check(`serves ${page}`, r.status === 200, `status ${r.status}`);
    }

    // ---- auth: passwordless flow ----
    let r = await fetch(`${BASE}/api/orders`);
    check('orders list requires auth', r.status === 401, `status ${r.status}`);

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

    // ---- deterministic SKU backfill preserves manual assignments ----
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
    check('product image upload returns persistent path', uploadA.response.status === 200 && /^images\/uploads\/product_upload_/.test(uploadA.body.path || ''));
    const servedUpload = await fetch(`${BASE}/${uploadA.body.path}`);
    check('persistent product image is served', servedUpload.status === 200 && String(servedUpload.headers.get('content-type') || '').startsWith('image/png'));
    r = await fetch(`${BASE}/api/upload-image`, json('POST', { dataUrl: 'data:image/png;base64,ZmFrZQ==' }, auth));
    check('product image upload rejects mismatched bytes', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/products/bulk-images`, json('POST', { items: [{ id: 1, img: 'images/placeholder.svg' }] }, auth));
    check('bulk mapping rejects unsafe image path', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/products/bulk-images`, json('POST', { items: [{ id: 1, img: 'images/uploads/../secrets.png' }] }, auth));
    check('bulk mapping rejects traversal path', r.status === 400, `status ${r.status}`);
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



    // Recovery code is a valid backup sign-in.
    r = await fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: reg.recoveryCodes[0] }));
    const rec = await r.json();
    check('recovery code signs in', r.status === 200 && !!rec.accessToken, `status ${r.status}`);
    r = await fetch(`${BASE}/api/auth/recovery`, json('POST', { email: 'owner@test.com', code: reg.recoveryCodes[0] }));
    check('recovery code is one-time', r.status === 400, `status ${r.status}`);

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
    // Products are picked by STOCK because the reservation guard now refuses
    // to promise more pieces than are genuinely available.
    const settings = await (await fetch(`${BASE}/api/settings`)).json();
    const moq = settings.wholesale_moq;
    const disc = settings.wholesale_discount;

    const unitFor = (p) => {
        let managed = null;
        try { const arr = JSON.parse(p.sizes); if (Array.isArray(arr) && arr.length) managed = arr; } catch (e) { /* base price path */ }
        return {
            sizeLabel: managed ? managed[0].label : '6M',
            unit: managed ? (managed[0].price != null ? managed[0].price : p.price) : p.price
        };
    };
    const sellable = (p) => p.fulfillment_type !== 'preorder' && p.price > 0;
    const retailP = products.find(p => sellable(p) && p.stock >= 3);
    const wholesaleP = products.find(p => sellable(p) && p.id !== retailP.id && p.stock >= moq + 2);
    check('seed has testable stock levels', !!retailP && !!wholesaleP);
    const { sizeLabel, unit: unitRetail } = unitFor(retailP);

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Smoke Test', customer_phone: '0241234567',
        order_type: 'retail', items: [{ id: retailP.id, quantity: 2, size: sizeLabel }]
    }));
    const order = await r.json();
    check('guest checkout creates order', r.status === 200 && order.success === true);
    check('order number assigned', /^ORD-\d+$/.test(order.order_number || ''), order.order_number);
    check(`retail total = unit x 2 (${unitRetail} x 2)`, close(order.total_amount, unitRetail * 2), `got ${order.total_amount}`);

    // ---- wholesale: per-piece discount, MOQ floor ----
    const w = unitFor(wholesaleP);
    const unitWs = Math.round(w.unit * (1 - disc / 100) * 100) / 100;

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: wholesaleP.id, quantity: moq, size: w.sizeLabel }]
    }));
    const wsOrder = await r.json();
    check(`wholesale total = discounted unit x MOQ (${unitWs} x ${moq})`,
        r.status === 200 && close(wsOrder.total_amount, unitWs * moq), `got ${wsOrder.total_amount}`);

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: wholesaleP.id, quantity: moq - 1, size: w.sizeLabel }]
    }));
    check('wholesale below MOQ rejected', r.status === 400, `status ${r.status}`);

    // ---- inventory reservations: pieces in pending orders can't sell twice ----
    const smallP = products.find(p => sellable(p) && p.id !== retailP.id && p.id !== wholesaleP.id && p.stock >= 1 && p.stock <= 5);
    const s = unitFor(smallP);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'First Buyer', customer_phone: '0243333333',
        order_type: 'retail', items: [{ id: smallP.id, quantity: smallP.stock, size: s.sizeLabel }]
    }));
    check('order for the entire remaining stock accepted', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Second Buyer', customer_phone: '0244444444',
        order_type: 'retail', items: [{ id: smallP.id, quantity: 1, size: s.sizeLabel }]
    }));
    check('overselling reserved stock rejected', r.status === 400, `status ${r.status}`);

    const emptyP = products.find(p => p.fulfillment_type !== 'preorder' && p.stock === 0);
    if (emptyP) {
        r = await fetch(`${BASE}/api/orders`, json('POST', {
            customer_name: 'X', customer_phone: '024', order_type: 'retail',
            items: [{ id: emptyP.id, quantity: 1, size: unitFor(emptyP).sizeLabel }]
        }));
        check('out-of-stock product rejected', r.status === 400, `status ${r.status}`);
    }

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

    // ---- customer accounts gated off by default ----
    r = await fetch(`${BASE}/api/customer/register`, json('POST', { name: 'X', email: 'x@x.com', password: 'longenough1' }));
    check('customer register gated off', r.status === 404, `status ${r.status}`);

    // ---- malformed JSON ----
    r = await fetch(`${BASE}/api/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json'
    });
    check('malformed JSON returns 400', r.status === 400, `status ${r.status}`);

    await runtime.shutdown('smoke test complete', 0, { exitProcess: false });
    check('graceful shutdown closes HTTP listener', !runtime.getServer().listening);
    let databaseClosed = false;
    try { await dbGet('SELECT 1'); } catch (error) { databaseClosed = true; }
    check('graceful shutdown closes SQLite', databaseClosed);

    console.log(`\n${passed} passed, ${failed} failed`);
    cleanupDb();
    process.exit(failed ? 1 : 0);
}

run().catch(err => {
    console.error('FATAL:', err);
    cleanupDb();
    process.exit(1);
});
