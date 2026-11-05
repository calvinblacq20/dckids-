// Smoke tests: boots the real server on a throwaway port + database and
// exercises the critical paths end-to-end. Run with `npm test` from server/.
// No test framework — plain assertions, exit 1 on any failure — so it runs
// anywhere Node runs, including a fresh clone with only `npm install` done.
const fs = require('fs');
const path = require('path');

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
process.env.OWNER_EMAIL = 'owner@test.com'; // the owner, on her first Google sign-in
process.env.GOOGLE_CLIENT_ID = 'smoke-client.apps.googleusercontent.com'; // Google itself is stood in for below
process.env.FIREBASE_API_KEY = 'smoke-public-api-key';
process.env.FIREBASE_AUTH_DOMAIN = 'smoke-test.firebaseapp.com';
process.env.FIREBASE_PROJECT_ID = 'smoke-test';
process.env.FIREBASE_APP_ID = '1:123:web:smoke';
process.env.JWT_SECRET = 'smoke-jwt-secret-used-only-by-tests';
process.env.VAPID_PUBLIC_KEY = '';           // push sends go through an injected recorder
process.env.VAPID_PRIVATE_KEY = '';

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
    // Google is the admin's only sign-in. The stand-in vouches for a credential
    // of the form "google:<email>" and nothing else.
    app.set('verifyGoogleIdToken', async (credential) => {
        const match = /^google:(.+@.+)$/.exec(credential);
        return match ? { email: match[1], email_verified: true, name: 'Smoke ' + match[1].split('@')[0], sub: 'sub-' + match[1] } : null;
    });
    const googleSignIn = (email) => fetch(`${BASE}/api/auth/google`, json('POST', { credential: 'google:' + email }));
    // Email goes to a recorder, so what the owner is sent can be read back.
    const emailed = [];
    app.set('emailSender', async (message) => { emailed.push(message); return { ok: true }; });
    const waitForEmail = async (match) => {
        for (let i = 0; i < 40; i++) {
            const found = emailed.find(match);
            if (found) return found;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
    };
    const db = require('./db');
    const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params || [], function(err) { err ? reject(err) : resolve(this); }));
    const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row)));

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

    const compressedCatalogue = await fetch(`${BASE}/api/products`, { headers: { 'Accept-Encoding': 'gzip' } });
    await compressedCatalogue.arrayBuffer();
    check('the catalogue is sent compressed for shoppers on mobile data',
        compressedCatalogue.headers.get('content-encoding') === 'gzip', `content-encoding ${compressedCatalogue.headers.get('content-encoding')}`);
    const missingPage = await fetch(`${BASE}/no-such-page`, { headers: { Accept: 'text/html' } });
    check('a mistyped link shows the shop\'s own page-not-found page',
        missingPage.status === 404 && (await missingPage.text()).includes('We can\'t find that page'), `status ${missingPage.status}`);
    const missingApi = await fetch(`${BASE}/api/no-such-thing`);
    check('an unknown API path answers 404 in JSON', missingApi.status === 404 && (await missingApi.json()).error === 'Not found', `status ${missingApi.status}`);
    const appScript = await fetch(`${BASE}/app.js`);
    await appScript.arrayBuffer();
    check('pages and code revalidate instead of downloading in full every visit',
        appScript.headers.get('cache-control') === 'no-cache' && !!(appScript.headers.get('etag') || appScript.headers.get('last-modified')),
        `cache-control ${appScript.headers.get('cache-control')}`);

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
    // China pre-order pieces carry their own CN- series, whatever their category.
    check('SKU prefixes cover every category', products.every(p => /^(CLO|SHO|ACC|NEW|BED|ESS|FEE|GEA|BAT|CN)-\d{4}$/.test(p.sku)), 'unexpected SKU prefix');
    // The owner's own China pre-order photos: all on disk, and a fresh database
    // gives each piece exactly its own gallery rather than borrowed shop photos.
    const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'products.json'), 'utf8'));
    const preorderPieces = snapshot.filter(p => p.fulfillment_type === 'preorder' && Array.isArray(p.images));
    check('the China pre-order pieces are in the catalogue with all their photos',
        preorderPieces.length >= 27 && preorderPieces.reduce((n, p) => n + p.images.length, 0) >= 78, `${preorderPieces.length} pieces`);
    check('every China pre-order photo is on disk and the first is the main image',
        preorderPieces.every(p => p.img === p.images[0] && p.images.every(img => fs.existsSync(path.join(__dirname, '..', img)))));
    const pieceDetail = await (await fetch(`${BASE}/api/products/${preorderPieces[0].id}`)).json();
    check('a fresh database gives a pre-order piece its own photos, in order',
        JSON.stringify(pieceDetail.images) === JSON.stringify(preorderPieces[0].images), JSON.stringify(pieceDetail.images));
    const sharedPage = await (await fetch(`${BASE}/product.html?id=${preorderPieces[0].id}`)).text();
    check('a product link shared on WhatsApp previews with its own name, price and photo',
        sharedPage.includes(`<meta property="og:title" content="${preorderPieces[0].name} · GH₵ 180.00">`) &&
        sharedPage.includes(`<meta property="og:image" content="${BASE}/${preorderPieces[0].img}">`) &&
        (sharedPage.match(/property="og:title"/g) || []).length === 1);
    const categoryAssets = ['newborn','clothing','shoes','feeding','gear','bathcare','essentials','accessories','bedding'];
    const imageResolver = require('../image-resolver');
    check('the generated category artwork is gone from the repository',
        !fs.existsSync(path.join(__dirname, '..', 'images', 'category-fallbacks')));
    // Flyers, a Christmas card, a promo collage, a wholesale text list and a
    // camera advert were all sitting in product slots.
    const retiredMarketing = ['product_2.jpg', 'product_11.jpg', 'product_12.jpg',
        'product_28.jpg', 'product_29.jpg', 'product_36.jpg', 'product_271_upload.jpg'];
    check('the marketing material is gone from the repository',
        retiredMarketing.every(name => !fs.existsSync(path.join(__dirname, '..', 'images', name))));
    check('no product in the catalogue points at generated artwork or marketing',
        products.every(p => {
            const img = String(p.img || '').replace(/\\/g, '/').toLowerCase();
            return !img.includes('category-fallbacks') &&
                !retiredMarketing.some(name => img.endsWith('/' + name));
        }));
    check('a product without a photo resolves to the placeholder', categoryAssets.every(name => {
        const resolved = imageResolver.resolve({ cat: name, img: '' });
        return resolved.src === 'images/placeholder.svg' && resolved.isPlaceholder === true;
    }));
    check('artwork paths left in older databases resolve to the placeholder', categoryAssets.every(name => {
        const resolved = imageResolver.resolve({ cat: name, img: 'images/category-fallbacks/' + name + '.webp' });
        return resolved.src === 'images/placeholder.svg' && resolved.isPlaceholder === true;
    }));
    check('the flyer and the logo cards resolve to the placeholder',
        ['product_2.jpg', 'product_50.jpg', 'product_66.jpg', 'product_83.jpg'].every(name => {
            const resolved = imageResolver.resolve({ cat: 'shoes', img: 'images/' + name });
            return resolved.src === 'images/placeholder.svg' && resolved.isPlaceholder === true;
        }));
    check('the database clears retired artwork instead of assigning it',
        /retireGeneratedArtwork[\s\S]*?category-fallbacks/.test(fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')));
    // A product pointing at a file that is not there renders a broken card,
    // and nothing else in the suite would notice.
    const missingFiles = products.filter((p) => p.img &&
        !fs.existsSync(path.join(__dirname, '..', ...String(p.img).split('/'))));
    check('every product image on disk', missingFiles.length === 0,
        missingFiles.slice(0, 5).map((p) => `${p.sku}:${p.img}`).join(', '));
    const onCatalogue = products.filter((p) => String(p.img || '').startsWith('images/catalogue/'));
    check('the supplier catalogue is wired up', onCatalogue.length >= 250,
        `got ${onCatalogue.length}`);
    check('catalogue images are square and web-sized', onCatalogue.slice(0, 12).every((p) => {
        const file = path.join(__dirname, '..', ...String(p.img).split('/'));
        return fs.statSync(file).size < 400 * 1024;
    }));
    // Section and category imagery is decorative: it carries the category's
    // own name and never stands in for a product the customer can order.
    const tileCats = ['clothing','shoes','accessories','feeding','gear',
        'bathcare','newborn','bedding','essentials'];
    check('every category tile image is on disk', tileCats.every((c) =>
        fs.existsSync(path.join(__dirname, '..', 'images', 'categories', c + '.webp'))));
    check('the editorial slots have their images', ['about.webp', 'new-arrivals.webp'].every((f) =>
        fs.existsSync(path.join(__dirname, '..', 'images', 'editorial', f))));
    const appForTiles = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    check('category art is kept out of the product fallback',
        appForTiles.includes('function categoryTileImage(cat)') &&
        appForTiles.includes("return r ? r.PLACEHOLDER : 'images/placeholder.svg';"));
    check('library imagery is credited',
        fs.readFileSync(path.join(__dirname, '..', 'docs', 'image-credits.md'), 'utf8')
            .includes('Unsplash License'));
    check('source catalogue contains no known logo placeholders', products.every(p => !imageResolver.isKnownLogoPlaceholder(p.img)));
    const realImage = imageResolver.resolve({ cat: 'clothing', img: 'images/product_42.jpg' });
    check('genuine product images remain unchanged', realImage.src === 'images/product_42.jpg' && realImage.isPlaceholder === false);
    // The size surcharge lives in four files. The server's copy is what an order
    // is charged; any other copy that differs shows the shopper a wrong price.
    const modifierFrom = (file) => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const match = /function getPriceModifier\(sizeLabel\) \{([\s\S]*?)\r?\n\s*\}\r?\n/.exec(source);
        return match ? new Function('sizeLabel', match[1]) : null;
    };
    const serverModifier = modifierFrom('server/server.js');
    const sizeLabels = ['0-3M', '12-18M', '18M', '24M', '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y', '12Y',
        '14', '21', '22', '27', '28', '32', '33', '34', '35', '36', 'One Size', ''];
    ['app.js', 'product.js', 'admin.js'].forEach((file) => {
        const modifier = modifierFrom(file);
        const drift = modifier ? sizeLabels.filter((s) => modifier(s) !== serverModifier(s)) : ['function not found'];
        check(`${file} adds the same size surcharge the server charges`, drift.length === 0, drift.join(', '));
    });
    // The same for the bulk price rule: a product's own bulk price, else the store-wide discount.
    const bulkRuleFrom = (file) => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const match = /function bulkFactor\(price, bulkPrice, discountPercent\) \{([\s\S]*?)\r?\n\s*\}\r?\n/.exec(source);
        return match ? new Function('price', 'bulkPrice', 'discountPercent', match[1]) : null;
    };
    const serverBulkRule = bulkRuleFrom('server/server.js');
    const bulkCases = [[180, 150, 20], [180, null, 20], [180, 180, 20], [180, 200, 20], [0, 150, 20], [60, 50, 0], [99, '', 15], ['45', '36', '20']];
    check('the server has one bulk price rule', typeof serverBulkRule === 'function' && serverBulkRule(180, 150, 20) === 150 / 180);
    ['app.js', 'product.js', 'admin.js'].forEach((file) => {
        const rule = bulkRuleFrom(file);
        const drift = rule ? bulkCases.filter((c) => rule(...c) !== serverBulkRule(...c)).map((c) => c.join('/')) : ['function not found'];
        check(`${file} prices bulk pieces the way the server charges them`, drift.length === 0, drift.join(', '));
    });
    // And where the bulk price starts: the minimum, with retail under it (ADR 0010).
    const fromRuleFrom = (file) => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const match = /function bulkApplies\(isWholesale, quantity, minimum\) \{([\s\S]*?)\r?\n\s*\}\r?\n/.exec(source);
        return match ? new Function('isWholesale', 'quantity', 'minimum', match[1]) : null;
    };
    const serverFromRule = fromRuleFrom('server/server.js');
    const fromCases = [[true, 10, 10], [true, 9, 10], [true, 11, '10'], [false, 50, 10], [true, 1, null], [true, 0, 0], [1, '10', 10], [true, 4, 5]];
    check('the server charges bulk from the minimum and retail under it',
        typeof serverFromRule === 'function' && serverFromRule(true, 10, 10) === true && serverFromRule(true, 9, 10) === false && serverFromRule(false, 99, 10) === false);
    ['app.js', 'product.js', 'admin.js'].forEach((file) => {
        const rule = fromRuleFrom(file);
        const drift = rule ? fromCases.filter((c) => rule(...c) !== serverFromRule(...c)).map((c) => c.join('/')) : ['function not found'];
        check(`${file} starts the bulk price where the server does`, drift.length === 0, drift.join(', '));
    });
    const swSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    check('service worker precaches the placeholder and no retired artwork',
        swSource.includes("/images/placeholder.svg") && !swSource.includes('category-fallbacks'));
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
    // Its own fetch() is held to the storefront policy, which blocks Google's
    // sign-in script: the one way into the admin.
    check('the service worker leaves other sites\' files, like Google sign-in, to the browser',
        /const url = new URL\(req\.url\);\s*(?:\/\/[^\n]*\n\s*)*if \(url\.origin !== self\.location\.origin\) return;/.test(swSource));
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
    check('checkout validation returns customers to their missing details',
        appSource.includes('$(firstBad[0]).focus()'));
    check('checkout offers WhatsApp as the only way to pay',
        storefrontSource.includes('id="place-btn"') && !storefrontSource.includes('id="pay-btn"') &&
        !appSource.includes('/api/checkout/') && !fs.existsSync(path.join(__dirname, '..', 'payment-result.html')));
    const storeStylesSource = fs.readFileSync(path.join(__dirname, '..', 'store.css'), 'utf8');
    check('no storefront surface still references the retired artwork',
        !appSource.includes('category-fallbacks') && !storeStylesSource.includes('card__image-label') &&
        !fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').includes('category-fallbacks'));
    check('the admin flags a product that has no photograph',
        fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8').includes('No photo</span>'));
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
    check('the pre-order section carries no fixed dates and stays hidden until a window opens',
        storefrontSource.includes('id="preorders" aria-labelledby="pre-title" hidden') &&
        storefrontSource.includes('<p class="pre__window-dates" id="pre-window-dates"></p>') &&
        !storefrontSource.includes('Orders close May 18th') &&
        !storefrontSource.includes('Ends May 18'));
    check('the China Pre-Order tab lists its pieces with category filters while the shop leaves them out',
        storefrontSource.includes('id="pre-grid"') && storefrontSource.includes('id="pre-filters"') &&
        appSource.includes('const items = products.filter(isPreorder);') &&
        appSource.includes('function inStockView(p) { return !isPreorder(p); }'));
    check('the China Pre-Order tab switches between retail and wholesale prices without leaving it',
        storefrontSource.includes('data-price-mode="wholesale" onclick="switchPrices(\'wholesale\')"') &&
        /function switchPrices\(mode\) \{[\s\S]*?renderPreorders\(\);/.test(appSource) &&
        /function setMode\(mode\) \{\s*if \(preorderView\) showPreorders\(false\);\s*switchPrices\(mode\);/.test(appSource));
    check('a pre-order piece never shows as sold out because of its stock count',
        appSource.includes('function isSoldOut(p) { return !isPreorder(p) && p.stock === 0; }'));
    // "Why can't I buy this?" — every block names its reason and offers a way round it.
    const productScriptSource = fs.readFileSync(path.join(__dirname, '..', 'product.js'), 'utf8');
    const adminSourceEarly = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
    check('the quick view says why a piece cannot be bought, and its main button offers the way round it',
        storefrontSource.includes('id="pdp-note" role="status" hidden') &&
        appSource.includes('const block = buyBlock(p);') &&
        appSource.includes("$('pdp-buy').dataset.action = block ? block.action : '';") &&
        appSource.includes("if (action === 'ask') {") &&
        !appSource.includes("$('pdp-buy').disabled = isSoldOut(p)"));
    check('sold out and no price each have their own words in the shop and on the product page',
        ['Sold out right now.', 'no price online yet'].every((s) => appSource.includes(s) && productScriptSource.includes(s)) &&
        productScriptSource.includes('China pre-orders are closed. Message us on WhatsApp'));
    check('fewer left than the wholesale minimum is never a block: they sell at retail, and both pages say so',
        !appSource.includes("action: 'retail'") && !productScriptSource.includes("action: 'retail'") &&
        ['-piece bulk minimum, so', 'at the retail price.'].every((s) => appSource.includes(s) && productScriptSource.includes(s)) &&
        appSource.includes("'Retail price — bulk prices start at '"));
    check('switching to wholesale never raises cart quantities behind the shopper\'s back',
        !appSource.includes('i.qty = Math.max(moq(), Math.ceil(i.qty / moq()) * moq())'));
    check('the product page main button acts on the reason instead of greying out',
        productScriptSource.includes('if (product && state.block) return runBlockAction();') &&
        productScriptSource.includes('addButton.disabled = false;'));
    check('admin takes wholesale rows at the counter (no stray return drops them)',
        !adminSourceEarly.includes("showToast('Wholesale needs at least ' + moq + ' pieces per item', 'warning');") &&
        /\/\/ wholesale order could be taken at the counter\.\)\s*items\.push\(\{/.test(adminSourceEarly));
    check('quantities stop at the stock and say so, in the quick view, the cart and the product page',
        appSource.includes('pdp.capped = dir > 0 && wanted > pdp.qty;') &&
        appSource.includes('if (p && dir > 0 && line.qty >= maxQtyFor(p)) toast(limitText(p));') &&
        productScriptSource.includes('const cap = stockCap(state.product) ? Math.min(999, stockCap(state.product)) : 999;') &&
        productScriptSource.includes("`Your cart already has all ${cap} of ${product.name}.`"));
    check('cart lines checkout would refuse are marked, and checkout waits until they are sorted',
        appSource.includes("(issue ? '<div class=\"citem__issue\">' + esc(issue) + '</div>' : '')") &&
        appSource.includes("$('checkout-btn').disabled = !cart.length || cartProblems() > 0;") &&
        appSource.includes('if (cartProblems()) { openCart(\'items\');'));
    check('a saved cart is brought up to date with the shop, and the shopper is told what changed',
        appSource.includes('if (i.qty > max) { i.qty = max; lowered++; }') &&
        appSource.includes('no longer in the shop, so we took it out.'));
    check('a checkout refusal stays on the form with a WhatsApp fallback instead of a fading toast',
        appSource.includes('function showCheckoutRefusal(message)') &&
        appSource.includes("showCheckoutRefusal(data.error || 'We could not place your order. Please try again.');") &&
        !appSource.includes("toast(data.error || 'We could not place your order."));
    check('when the order service is not answering, checkout sends the order on WhatsApp instead of failing',
        appSource.includes('const unsaved = !data || res.status >= 500;') && storefrontSource.includes('id="done-ref-line"'));
    const authSource = fs.readFileSync(path.join(__dirname, '..', 'firebase-auth.js'), 'utf8');
    check('without customer sign-in, the shop hides its account links and the account page says what still works',
        authSource.includes('state.unconfigured = true;') && appSource.includes('a.hidden = !customerState.configured;') &&
        fs.readFileSync(path.join(__dirname, '..', 'account.js'), 'utf8').includes("'Accounts are coming soon'"));
    // Shown first and hidden once the sign-in library arrived, they flickered on phones.
    const accountAnchors = (html) => [...html.matchAll(/<a\b[^>]*href="\/account\.html"[^>]*>/g)].map((m) => m[0]);
    const productPageHtml = fs.readFileSync(path.join(__dirname, '..', 'product.html'), 'utf8');
    check('the shop and product page account links start hidden until customer sign-in loads',
        accountAnchors(storefrontSource).length === 3 && accountAnchors(productPageHtml).length === 1 &&
        [...accountAnchors(storefrontSource), ...accountAnchors(productPageHtml)].every((tag) => /\shidden[\s>]/.test(tag)) &&
        fs.readFileSync(path.join(__dirname, '..', 'product.js'), 'utf8').includes('a.hidden = !state.auth.configured;'));
    // Phones used to lose the account link from the top bar altogether.
    check('the shop\'s top bar keeps an account icon on every screen size, the word only where it fits',
        storefrontSource.includes('<span class="nav__account-label" id="account-label">') &&
        appSource.includes("$('account-label').textContent = accountLabel;") &&
        !/\.nav__account(?![\w-])[^{]*\{\s*display:\s*none/.test(storeStylesSource));
    const trackSource = fs.readFileSync(path.join(__dirname, '..', 'track.html'), 'utf8');
    check('tracking shows a paid order as moving and names statuses in words',
        trackSource.includes("awaiting_payment: 'Awaiting payment'") && trackSource.includes("s === 'paid') return 2;"));
    const contactPages = ['track.html', 'support.html', 'account.html', 'privacy.html', 'terms.html'];
    check('pages without the shop script follow the WhatsApp number set in admin',
        contactPages.every((page) => fs.readFileSync(path.join(__dirname, '..', page), 'utf8').includes('shop-contact.js')) &&
        !trackSource.includes("'https://wa.me/233549193805?text='"));
    const catLabelsBlock = (appSource.match(/const CAT_LABELS = \{([\s\S]*?)\};/) || [])[1] || '';
    const unlabelledCats = [...new Set(snapshot.map(p => p.cat))].filter(c => c && !new RegExp('\\b' + c + ':').test(catLabelsBlock));
    check('every catalogue category has a storefront name', unlabelledCats.length === 0, unlabelledCats.join(', '));
    const productPageSource = fs.readFileSync(path.join(__dirname, '..', 'product.html'), 'utf8');
    const productStylesSource = fs.readFileSync(path.join(__dirname, '..', 'product.css'), 'utf8');
    const supportPageSource = fs.readFileSync(path.join(__dirname, '..', 'support.html'), 'utf8');
    const adminPageSource = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
    check('the admin offers no way to make a second owner', !adminPageSource.includes('value="manager"'));
    check('the phone tab bar stays off the sign-in screens',
        fs.readFileSync(path.join(__dirname, '..', 'admin-bridge.css'), 'utf8').includes('body:not(.is-authed) .mobile-bottom-nav'));
    check('the admin signs in with Google only: no emailed codes, recovery codes or request form',
        adminPageSource.includes('id="google-signin-btn"') &&
        !/login-step-code|login-step-recovery|recovery-codes-overlay|signup-container|recovery-security-card|admin-recovery-view/.test(adminPageSource) &&
        !/auth\/request-code|auth\/verify-code|auth\/recovery|recovery-codes|admin\/register/.test(adminSource));
    check('a first Google sign-in from a new address shows as a request, not an error',
        adminSource.includes('if (r.data.pending) return _loginInfo(r.data.error);'));
    check('the staff list keeps sign-up names and emails out of onclick handlers',
        !adminSource.includes("onclick=\"openEditStaffModal(' + u.id") && !adminSource.includes("onclick=\"confirmDeleteStaff(' + u.id") &&
        adminSource.includes('data-staff-edit="'));
    check('a failed order delete is reported, never shown as done',
        !adminSource.includes('.catch(function() { localRemove(); })') && adminSource.includes('the order was not deleted'));
    check('admin\'s counter quote prices a size with its own price the way the server does',
        adminSource.includes('var modifier = sizeMatch ? 0 : getPriceModifier(size);'));
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
    // No demo anywhere: the admin opens only through the real sign-in.
    check('the demo mode and demo data script are gone',
        !fs.existsSync(path.join(__dirname, '..', 'admin-demo.js')) && !fs.existsSync(path.join(__dirname, 'seed_demo.js')) &&
        !adminPageSource.includes('admin-demo.js') && !adminPageSource.includes("get('demo')") &&
        !fs.readFileSync(path.join(__dirname, '..', 'admin-bridge.css'), 'utf8').includes('demo-banner'));
    check('no fake token opens the admin: every session is checked with the server',
        !adminSource.includes('fallback-token') &&
        /var token = localStorage\.getItem\('adminToken'\);\s*if \(token\) \{\s*fetch\(API_URL \+ '\/me'/.test(adminSource));
    check('where there is no server (the static preview), sign-in says so instead of failing',
        adminSource.includes("if (!/json/.test(res.headers.get('content-type') || '')) throw new Error('no-server');") &&
        adminSource.includes('this copy of the site has none'));
    check('the shop, the product page and the admin all use the owner\'s category list from the server',
        appSource.includes("fetch('/api/categories')") && appSource.includes('catOrder = list.map(') &&
        productScriptSource.includes("getJson('/api/categories', null)") &&
        adminSourceEarly.includes("fetch(API_URL + '/categories'") && adminSourceEarly.includes("method: 'PUT'") &&
        !adminSourceEarly.includes("localStorage.setItem('dcKidsCategories'") && !adminSourceEarly.includes('<option value="baby">Baby</option>'));
    check('the admin\'s 45-second poll asks only for changes, with a full refresh every 15 minutes',
        adminSourceEarly.includes("'/orders?since=' + encodeURIComponent(__ordersCursor)") &&
        adminSourceEarly.includes('if (ticks % 20 === 0) fetchOrdersFromServer();') && adminSourceEarly.includes('else fetchOrderChanges();'));
    check('the docs describe the real sign-in, not the old admin password',
        ['README.md', 'DEPLOYMENT.md'].every((doc) => !/ADMIN_PASSWORD|admin123/.test(fs.readFileSync(path.join(__dirname, '..', doc), 'utf8'))));
    check('mobile product page exposes a synchronized quick-add bar',
        productPageSource.includes('id="productMobileBuybar"') &&
        productStylesSource.includes('.product-mobile-buybar') &&
        fs.readFileSync(path.join(__dirname, '..', 'product.js'), 'utf8').includes("byId('productMobileAdd').addEventListener('click', addToCart)"));
    check('storefront footer has no placeholder destinations or unrelated contact number',
        !storefrontSource.includes('<a href="#" class="hover:text-white transition-colors">') &&
        !storefrontSource.includes('+233 59 123 4567') &&
        storefrontSource.includes('tel:+233549193805'));
    check('customers can open a receipt after checkout, when tracking and in their account',
        storefrontSource.includes('src="receipt.js') && appSource.includes('function openLastReceipt') &&
        ['track.html', 'account.html'].every((page) =>
            fs.readFileSync(path.join(__dirname, '..', page), 'utf8').includes('src="receipt.js')));
    // Vercel serves the site without the API; settings.json stands in for /api/settings.
    const staticSettings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8'));
    const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
    check('a static deploy falls back to settings.json for the announcement and wholesale switch',
        appSource.includes("['/api/settings', '/settings.json']") &&
        staticSettings.wholesale_enabled === 1 && staticSettings.wholesale_moq > 0 && staticSettings.banner_enabled === 1 &&
        !!String(staticSettings.banner_text || '').trim());
    check('settings.json run dates are real days in order',
        isDay(staticSettings.banner_starts) && isDay(staticSettings.banner_ends) && staticSettings.banner_starts <= staticSettings.banner_ends);
    check('settings.json carries a real China pre-order window for the static deploy',
        isDay(staticSettings.preorder_starts) && isDay(staticSettings.preorder_ends) && staticSettings.preorder_starts <= staticSettings.preorder_ends);
    check('settings.json links the DC Sourcing WhatsApp group the way the storefront accepts it',
        /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/.test(staticSettings.whatsapp_group_url || ''));
    const workerSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    check('the service worker fetches settings and the catalogue live, static copies included',
        workerSource.includes("['/api/settings', '/settings.json', '/api/products', '/products.json'].includes(url.pathname)"));
    check('the service worker keeps the last catalogue for offline shoppers',
        /if \(isLiveConfig\) \{\s*event\.respondWith\(fetch\(req\)\.then\(\(res\) => \{\s*if \(res\.ok\) \{[\s\S]*?c\.put\(req, copy\)/.test(workerSource));
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
    check('admin auth config gives the Google client id and nothing else',
        r.status === 200 && JSON.stringify(adminAuthConfig) === JSON.stringify({ googleClientId: process.env.GOOGLE_CLIENT_ID }),
        JSON.stringify(adminAuthConfig));

    // ---- auth: Google is the only sign-in ----
    r = await fetch(`${BASE}/api/orders`);
    check('orders list requires auth', r.status === 401, `status ${r.status}`);
    r = await fetch(`${BASE}/api/admin/customers`);
    check('admin customer directory requires auth', r.status === 401, `status ${r.status}`);

    for (const gone of ['/api/admin/register', '/api/auth/request-code', '/api/auth/verify-code', '/api/auth/recovery', '/api/admin/recovery-codes/regenerate']) {
        r = await fetch(`${BASE}${gone}`, json('POST', { email: 'owner@test.com', code: '123456' }));
        check(`the old code sign-in ${gone} is gone`, r.status === 404, `status ${r.status}`);
    }
    check('the emailed and recovery code tables are dropped',
        !(await dbGet("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('auth_codes', 'recovery_codes')")));

    r = await fetch(`${BASE}/api/auth/google`, json('POST', { credential: 'forged-credential' }));
    check('a credential Google does not vouch for is refused', r.status === 401, `status ${r.status}`);

    // The OWNER_EMAIL address becomes the owner on its first Google sign-in.
    r = await googleSignIn('owner@test.com');
    const login = await r.json();
    check('the owner\'s first Google sign-in opens her account as owner',
        r.status === 200 && !!login.accessToken && login.role === 'manager', `status ${r.status}, role ${login.role}`);
    check('signing in hands out no recovery codes', !('recoveryCodes' in login));
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

    // The admin's "More photos": a manager replaces a gallery, but only with files the site serves.
    const galleryTarget = preorderPieces[1];
    const keptPhotos = galleryTarget.images.slice().reverse().slice(0, 2);
    const putGallery = (id, images, headers) => fetch(`${BASE}/api/products/${id}/images`, json('PUT', { images }, headers));
    r = await putGallery(galleryTarget.id, keptPhotos);
    check('changing a product\'s photos needs a signed-in manager', r.status === 401 || r.status === 403, `status ${r.status}`);
    r = await putGallery(galleryTarget.id, keptPhotos, auth);
    const galleryAfter = await (await fetch(`${BASE}/api/products/${galleryTarget.id}`)).json();
    check('a manager can remove and reorder a product\'s photos',
        r.status === 200 && JSON.stringify(galleryAfter.images) === JSON.stringify(keptPhotos), JSON.stringify(galleryAfter.images));
    r = await putGallery(galleryTarget.id, ['images/../server/secret.png'], auth);
    check('a gallery path outside the images folder is refused', r.status === 400, `status ${r.status}`);
    r = await putGallery(galleryTarget.id, ['images/preorders/not-a-real-photo.webp'], auth);
    check('a gallery photo that is not on disk is refused', r.status === 400, `status ${r.status}`);
    r = await putGallery(galleryTarget.id, Array(13).fill(keptPhotos[0]), auth);
    check('a gallery holds at most twelve photos', r.status === 400, `status ${r.status}`);
    r = await putGallery(999999, keptPhotos, auth);
    check('photos for a missing product return 404', r.status === 404, `status ${r.status}`);

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


    // A first Google sign-in from an unknown address asks the owner for access.
    r = await googleSignIn('staff@test.com');
    const requested = await r.json();
    check('a new address\'s first Google sign-in becomes an access request, without a session',
        r.status === 403 && requested.pending === true && !requested.accessToken, `status ${r.status}`);
    const requestRow = await dbGet("SELECT status, role FROM users WHERE email = 'staff@test.com'");
    check('the access request waits for the owner as pending staff',
        requestRow && requestRow.status === 'pending' && requestRow.role === 'staff', JSON.stringify(requestRow));
    const requestEmail = await waitForEmail((m) => m.subject === 'New DC Kids admin access request');
    check('an access request emails the owner', !!requestEmail && requestEmail.to === 'owner@test.com', JSON.stringify(requestEmail && requestEmail.to));
    r = await googleSignIn('staff@test.com');
    const stillPending = await r.json();
    check('a pending request still cannot sign in', r.status === 403 && stillPending.pending === true && !stillPending.accessToken,
        `status ${r.status}`);

    // Owner adds a staff member directly — active immediately.
    r = await fetch(`${BASE}/api/users`, json('POST', { full_name: 'Direct Staff', email: 'direct@test.com', role: 'staff' }, auth));
    const created = await r.json();
    check('owner adds staff directly', r.status === 201 && created.id > 0, `status ${r.status}`);

    // Sign the new staff member in, so we can prove their session dies the
    // moment they're deleted.
    r = await googleSignIn('direct@test.com');
    const staffLogin = await r.json();
    check('direct staff can sign in with Google', r.status === 200 && !!staffLogin.accessToken && staffLogin.role === 'staff',
        `status ${r.status}, role ${staffLogin.role}`);

    r = await fetch(`${BASE}/api/users/${created.id}`, { method: 'DELETE', headers: auth });
    check('a staff account that has signed in can be deleted', r.status === 200, `status ${r.status}`);

    // Their still-unexpired JWT must be dead immediately (per-request re-check).
    r = await fetch(`${BASE}/api/orders`, { headers: { 'Authorization': `Bearer ${staffLogin.accessToken}` } });
    check('deleted staff token revoked instantly', r.status === 403, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Gone Staff', customer_phone: '0240000099', order_type: 'retail', discount_percent: 100,
        items: [{ id: 1, quantity: 1, size: '6M' }]
    }, { 'Authorization': `Bearer ${staffLogin.accessToken}` }));
    check('a deleted staff member\'s token can no longer place counter orders or give discounts', r.status === 403, `status ${r.status}`);

    // ---- one owner: everyone the owner adds or approves is staff ----
    r = await fetch(`${BASE}/api/users`, json('POST', { full_name: 'Would Be Manager', email: 'second@test.com', role: 'manager' }, auth));
    const second = await r.json();
    check('an account the owner adds is staff even when manager is asked for',
        r.status === 201 && second.role === 'staff' && (await dbGet("SELECT role FROM users WHERE email = 'second@test.com'")).role === 'staff');
    r = await fetch(`${BASE}/api/users/${second.id}`, json('PUT', { role: 'manager' }, auth));
    check('no one can be made a second owner', r.status === 400, `status ${r.status}`);
    const pendingRequest = await dbGet("SELECT id FROM users WHERE email = 'staff@test.com'");
    r = await fetch(`${BASE}/api/admin/access-requests/${pendingRequest.id}/approve`, json('POST', { role: 'manager' }, auth));
    check('an approved request joins as staff', r.status === 200 && (await dbGet('SELECT role FROM users WHERE id = ?', [pendingRequest.id])).role === 'staff');
    const ownerRow = await dbGet("SELECT id FROM users WHERE email = 'owner@test.com'");
    r = await fetch(`${BASE}/api/users/${ownerRow.id}`, json('PUT', { role: 'staff' }, auth));
    check('the owner cannot be demoted', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/users/${ownerRow.id}`, json('PUT', { email: 'someone-else@test.com' }, auth));
    check('the owner\'s sign-in email stays the one on OWNER_EMAIL', r.status === 400, `status ${r.status}`);
    // An older row that still says manager only gets staff powers.
    await dbRun("UPDATE users SET role = 'manager' WHERE id = ?", [second.id]);
    const secondLogin = await (await googleSignIn('second@test.com')).json();
    check('a stray manager row signs in as staff', secondLogin.role === 'staff', `got ${secondLogin.role}`);
    r = await fetch(`${BASE}/api/users`, { headers: { 'Authorization': `Bearer ${secondLogin.accessToken}` } });
    check('a stray manager row cannot open owner-only pages', r.status === 403, `status ${r.status}`);
    r = await fetch(`${BASE}/api/users`, { headers: auth });
    const accounts = await r.json();
    check('the staff list shows exactly one owner, the one on OWNER_EMAIL',
        accounts.filter(a => a.owner).length === 1 && accounts.find(a => a.owner).email === 'owner@test.com' &&
        accounts.filter(a => a.role === 'manager').length === 1);

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
    const listedAfterOrder = (await (await fetch(`${BASE}/api/products`)).json()).find((p) => p.id === 1);
    const heldByOrders = (await dbGet(
        `SELECT COALESCE(SUM(oi.quantity), 0) AS held FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = 1 AND o.status IN ('pending', 'pending_deposit', 'awaiting_payment', 'payment_review', 'processing')`)).held;
    check('the shop shows the stock left after open orders, not the raw count',
        heldByOrders >= 2 && listedAfterOrder.available === Math.max(0, listedAfterOrder.stock - heldByOrders),
        `stock ${listedAfterOrder.stock}, held ${heldByOrders}, available ${listedAfterOrder.available}`);
    r = await fetch(`${BASE}/api/analytics/sales?period=week`, { headers: auth });
    const pendingAnalytics = await r.json();
    check('pending WhatsApp orders are excluded from recognized revenue',
        r.status === 200 && Number(pendingAnalytics.kpis.totalRevenue || 0) === 0,
        `got ${pendingAnalytics.kpis && pendingAnalytics.kpis.totalRevenue}`);

    // ---- was-prices and the WhatsApp-list welcome offer ----
    r = await fetch(`${BASE}/api/products/1`, json('PUT', Object.assign({}, p1, { stock: 200, compare_at_price: p1.price }), auth));
    check('a was price at or below the price is refused', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/products/1`, json('PUT', Object.assign({}, p1, { stock: 200, compare_at_price: p1.price * 2 }), auth));
    check('a was price above the price is saved', r.status === 200 && close((await dbGet('SELECT compare_at_price FROM products WHERE id = 1')).compare_at_price, p1.price * 2));
    const { compare_at_price: _ignored, ...withoutCompare } = Object.assign({}, p1, { stock: 200 });
    await fetch(`${BASE}/api/products/1`, json('PUT', withoutCompare, auth));
    check('an older admin page that omits the was price keeps it', close((await dbGet('SELECT compare_at_price FROM products WHERE id = 1')).compare_at_price, p1.price * 2));

    // ---- a product's own bulk price (the slides: GH₵180 each, GH₵150 each from ten) ----
    const slides = snapshot.find(p => p.sku === 'CN-0001');
    const slidesRow = await dbGet('SELECT * FROM products WHERE id = ?', [slides.id]);
    check('a fresh database carries the slides\' bulk price', close(slidesRow.wholesale_price, 150), `got ${slidesRow.wholesale_price}`);
    const putSlides = (changes) => fetch(`${BASE}/api/products/${slides.id}`, json('PUT', Object.assign({}, slidesRow, changes), auth));
    const storedBulk = async () => (await dbGet('SELECT wholesale_price FROM products WHERE id = ?', [slides.id])).wholesale_price;
    r = await putSlides({ wholesale_price: slidesRow.price });
    check('a bulk price at or above the selling price is refused', r.status === 400, `status ${r.status}`);
    r = await putSlides({ wholesale_price: 140 });
    check('a bulk price below the selling price is saved', r.status === 200 && close(await storedBulk(), 140), `status ${r.status}`);
    const { wholesale_price: _bulkIgnored, ...slidesWithoutBulk } = slidesRow;
    await fetch(`${BASE}/api/products/${slides.id}`, json('PUT', slidesWithoutBulk, auth));
    check('an older admin page that omits the bulk price keeps it', close(await storedBulk(), 140));
    await fetch(`${BASE}/api/products/${slides.id}`, json('PUT', Object.assign({}, slidesWithoutBulk, { price: 130 }), auth));
    check('a bulk price is dropped once the selling price falls to it', (await storedBulk()) === null, `got ${await storedBulk()}`);
    await putSlides({ wholesale_price: 140 });
    r = await fetch(`${BASE}/api/products/bulk-update`, json('POST', { ids: [slides.id], fields: { price: 140 } }, auth));
    check('repricing many products at once also drops a bulk price it no longer undercuts', r.status === 200 && (await storedBulk()) === null, `got ${await storedBulk()}`);
    r = await putSlides({ wholesale_price: 150 });
    check('the slides are back to GH₵180 with a GH₵150 bulk price',
        r.status === 200 && close(await storedBulk(), 150) && close((await dbGet('SELECT price FROM products WHERE id = ?', [slides.id])).price, 180));
    const storeSettings = await (await fetch(`${BASE}/api/settings`)).json();
    check('the welcome offer starts on at 10%', Number(storeSettings.welcome_enabled) === 1 && Number(storeSettings.welcome_percent) === 10);
    r = await fetch(`${BASE}/api/whatsapp-signups`, json('POST', { phone: '12', consent: true }));
    check('a sign-up needs a real WhatsApp number', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/whatsapp-signups`, json('POST', { phone: '024 555 0101' }));
    check('a sign-up needs consent', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/whatsapp-signups`, json('POST', { phone: '024 555 0101', consent: true }));
    const signup = await r.json();
    check('a sign-up is saved in one number format and offered 10%', r.status === 200 && signup.eligible === true && signup.percent === 10 &&
        !!(await dbGet("SELECT id FROM whatsapp_signups WHERE phone = '233245550101'")));
    const welcomeOrder = async (phone, orderType) => (await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Welcome Buyer', customer_phone: phone, order_type: orderType || 'retail', items: [{ id: 1, quantity: orderType === 'wholesale' ? 10 : 1, size: sizeLabel }]
    }))).json();
    const firstWelcome = await welcomeOrder('+233 24 555 0101');
    check('the first order from a signed-up number gets 10% off', firstWelcome.welcome_discount === 10 && close(firstWelcome.total_amount, unitRetail * 0.9),
        `got ${firstWelcome.total_amount}`);
    const secondWelcome = await welcomeOrder('0245550101');
    check('the welcome offer is used once per number', secondWelcome.welcome_discount === 0 && close(secondWelcome.total_amount, unitRetail));
    const firstWelcomeRow = await dbGet('SELECT id FROM orders WHERE order_number = ?', [firstWelcome.order_number]);
    await fetch(`${BASE}/api/orders/${firstWelcomeRow.id}`, json('PUT', { status: 'cancelled' }, auth));
    const wholesaleWelcome = await welcomeOrder('0245550101', 'wholesale');
    check('wholesale orders do not take the welcome offer', wholesaleWelcome.welcome_discount === 0);
    const retryWelcome = await welcomeOrder('0245550101');
    check('cancelling the order gives the welcome offer back', retryWelcome.welcome_discount === 10);
    r = await fetch(`${BASE}/api/whatsapp-signups`);
    check('the WhatsApp list needs a manager sign-in', r.status === 401, `status ${r.status}`);
    r = await fetch(`${BASE}/api/whatsapp-signups`, { headers: auth });
    const signupList = await r.json();
    check('managers see who joined and which order used the offer', r.status === 200 && signupList.total === 1 && signupList.signups[0].order_number === retryWelcome.order_number);
    r = await fetch(`${BASE}/api/whatsapp-signups/${signupList.signups[0].id}`, { method: 'DELETE', headers: auth });
    check('a number can be removed from the WhatsApp list', r.status === 200 && !(await dbGet('SELECT id FROM whatsapp_signups')));

    // ---- order alerts on staff devices (Web Push) ----
    // The network send is swapped for a recorder; everything else is the real path.
    const pushed = [];
    const waitForPush = async (match) => {
        for (let i = 0; i < 40 && !pushed.some(match); i++) await new Promise((done) => setTimeout(done, 50));
        return pushed.some(match);
    };
    app.set('webPushSender', async (subscription, payload) => { pushed.push({ endpoint: subscription.endpoint, message: JSON.parse(payload) }); });
    const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/smoke-device', keys: { p256dh: 'BSmokePublicKey', auth: 'smokeAuthSecret' } };
    r = await fetch(`${BASE}/api/push/config`);
    check('order-alert settings need a staff sign-in', r.status === 401, `status ${r.status}`);
    r = await fetch(`${BASE}/api/push/config`, { headers: auth });
    check('order alerts report off until VAPID keys are set', r.status === 200 && (await r.json()).enabled === false);
    r = await fetch(`${BASE}/api/push/subscribe`, json('POST', device));
    check('subscribing a device to order alerts needs a staff sign-in', r.status === 401, `status ${r.status}`);
    r = await fetch(`${BASE}/api/push/subscribe`, json('POST', Object.assign({}, device, { endpoint: 'https://collector.example.com/push' }), auth));
    check('only browser push services are accepted as alert endpoints', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/push/subscribe`, json('POST', device, auth));
    check('staff can subscribe a device to order alerts', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/push/test`, json('POST', {}, auth));
    const testAlert = await r.json();
    check('a test alert reaches the subscribed device', r.status === 200 && testAlert.sent === 1 && pushed.some((p) => p.message.tag === 'dckids-test'));
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Alert Buyer', customer_phone: '0246666666', order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const alertOrder = await r.json();
    check('a new order alerts subscribed staff devices',
        await waitForPush((p) => p.message.title === 'New order · ' + alertOrder.order_number && p.message.body.includes('Alert Buyer')));

    // ---- a WhatsApp payment, recorded by staff ----
    // The money arrives on WhatsApp (mobile money or bank), so an order is paid
    // only when staff record it. That one step must settle everything payment
    // implies: the payment row, the takings, revenue and the shelf.
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'MoMo Payer', customer_phone: '0249000000', order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const momoOrder = await r.json();
    const momoOrderId = (await dbGet('SELECT id FROM orders WHERE order_number = ?', [momoOrder.order_number])).id;
    const momoBefore = await dbGet('SELECT payment_method, status FROM payments WHERE order_id = ?', [momoOrderId]);
    check('a WhatsApp order waits as an unpaid WhatsApp payment',
        momoBefore.payment_method === 'WhatsApp' && momoBefore.status === 'pending', JSON.stringify(momoBefore));
    const stockBeforePayment = (await dbGet('SELECT stock FROM products WHERE id = 1')).stock;
    r = await fetch(`${BASE}/api/orders/${momoOrderId}`, json('PUT', { status: 'paid' }, auth));
    check('staff can record a WhatsApp payment', r.status === 200, `status ${r.status}`);
    const momoPaid = await dbGet('SELECT status, paid_at FROM payments WHERE order_id = ?', [momoOrderId]);
    check('recording it marks the payment paid, with the time it landed',
        momoPaid.status === 'paid' && !!momoPaid.paid_at, JSON.stringify(momoPaid));
    r = await fetch(`${BASE}/api/admin/payments?period=7`, { headers: auth });
    const takings = await r.json();
    check('the recorded payment shows in the admin payments as WhatsApp, for the order total',
        takings.payments.some((p) => p.order_number === momoOrder.order_number && p.method === 'WhatsApp' && close(p.amount, momoOrder.total_amount)));
    r = await fetch(`${BASE}/api/analytics/sales?period=week`, { headers: auth });
    const paidAnalytics = await r.json();
    check('a recorded payment counts as revenue',
        r.status === 200 && close(Number(paidAnalytics.kpis.totalRevenue || 0), momoOrder.total_amount),
        `got ${paidAnalytics.kpis && paidAnalytics.kpis.totalRevenue}`);
    check('the top payment method is the one recorded on the payment',
        paidAnalytics.insights.topPayment.label === 'WhatsApp', paidAnalytics.insights.topPayment.label);
    const stockAfterPayment = (await dbGet('SELECT stock FROM products WHERE id = 1')).stock;
    check('a recorded payment takes the piece off the shelf once',
        stockAfterPayment === Math.max(0, stockBeforePayment - 1), `${stockBeforePayment} -> ${stockAfterPayment}`);
    r = await fetch(`${BASE}/api/orders/${momoOrderId}`, json('PUT', { status: 'paid' }, auth));
    check('recording the same payment twice changes nothing',
        r.status === 200 && (await dbGet('SELECT stock FROM products WHERE id = 1')).stock === stockAfterPayment);
    // A paid order whose payment row is missing (an import, a failed insert)
    // still earns revenue; how it was paid is unknown and must be shown so.
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'No Record', customer_phone: '0249000008', order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const unrecordedNumber = (await r.json()).order_number;
    const unrecordedId = (await dbGet('SELECT id FROM orders WHERE order_number = ?', [unrecordedNumber])).id;
    await dbRun('DELETE FROM payments WHERE order_id = ?', [unrecordedId]);
    await fetch(`${BASE}/api/orders/${unrecordedId}`, json('PUT', { status: 'paid' }, auth));
    r = await fetch(`${BASE}/api/analytics/sales?period=week`, { headers: auth });
    const reportedMethods = (await r.json()).paymentPerformance.map((p) => p.method);
    check('a paid order with no payment on record is reported as not recorded',
        reportedMethods.includes('Not recorded'), reportedMethods.join(','));
    check('no payment method is reported that nobody recorded',
        reportedMethods.every((method) => ['WhatsApp', 'Not recorded'].includes(method)), reportedMethods.join(','));
    await fetch(`${BASE}/api/orders/${unrecordedId}`, json('PUT', { status: 'cancelled' }, auth));
    r = await fetch(`${BASE}/api/checkout/paystack`, json('POST', {
        customer_name: 'Card Payer', customer_phone: '0249000009', order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    check('there is no card checkout to start', r.status === 404, `status ${r.status}`);
    r = await fetch(`${BASE}/api/payments/paystack/webhook`, json('POST', { event: 'charge.success', data: { reference: 'DCK-1-x' } }));
    check('nothing answers a payment-provider webhook', r.status === 404, `status ${r.status}`);

    const laptop = Object.assign({}, device, { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/smoke-laptop' });
    await fetch(`${BASE}/api/push/subscribe`, json('POST', laptop, auth));
    r = await fetch(`${BASE}/api/push/unsubscribe`, json('POST', { endpoint: laptop.endpoint }, auth));
    check('turning alerts off removes only that device',
        r.status === 200 && (await dbGet('SELECT COUNT(*) AS count FROM push_subscriptions')).count === 1);
    app.set('webPushSender', async () => {
        const gone = new Error('push subscription has unsubscribed or expired');
        gone.statusCode = 410;
        throw gone;
    });
    await fetch(`${BASE}/api/push/test`, json('POST', {}, auth));
    check('a device the browser dropped is removed from order alerts',
        (await dbGet('SELECT COUNT(*) AS count FROM push_subscriptions')).count === 0);
    app.set('webPushSender', undefined);

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
    // The old email-and-password reset is retired: Firebase owns customer passwords.
    for (const route of ['forgot-password', 'reset-password']) {
        r = await fetch(`${BASE}/api/customer/${route}`, json('POST', { email: 'new.customer@test.com', token: 'x', password: 'whatever-long' }));
        check(`the old customer ${route} route says it is retired`, r.status === 410 && /retired/i.test((await r.json()).error || ''), `status ${r.status}`);
    }

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
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Updated Customer', customer_phone: '0244444444', customer_email: 'spoofed@test.com',
        order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }, customerAuth));
    const signedInOrder = await r.json();
    const signedInDb = await dbGet('SELECT customer_account_id, customer_email FROM orders WHERE order_number = ?', [signedInOrder.order_number]);
    check('a signed-in order uses the verified account identity, not the typed email',
        r.status === 200 && signedInDb.customer_account_id === customerId && signedInDb.customer_email === 'new.customer@test.com');
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

    // ---- categories: the owner's names and order, on the server ----
    r = await fetch(`${BASE}/api/categories`);
    const seededCats = await r.json();
    check('the shop\'s categories come from the server, seeded with the names and order shoppers saw before',
        r.status === 200 && Array.isArray(seededCats) && seededCats.slice(0, 3).map((c) => c.label).join('|') === 'Newborn|Clothing|Shoes' &&
        seededCats.every((c, i) => c.position === i), JSON.stringify(seededCats.slice(0, 3)));
    const catPut = (list, headers) => fetch(`${BASE}/api/categories`, json('PUT', { categories: list }, headers));
    r = await catPut(seededCats);
    check('only a signed-in manager can change categories', r.status === 401, `status ${r.status}`);
    const renamed = seededCats.map((c) => (c.id === 'clothing' ? { id: c.id, label: 'Kids wear' } : { id: c.id, label: c.label }));
    const shoesFirst = [renamed.find((c) => c.id === 'shoes')].concat(renamed.filter((c) => c.id !== 'shoes'), [{ id: 'toys', label: 'Toys' }]);
    r = await catPut(shoesFirst, auth);
    const savedCats = await r.json();
    const readBack = await (await fetch(`${BASE}/api/categories`)).json();
    check('a manager renames, reorders and adds categories, and the shop reads them back',
        r.status === 200 && readBack[0].id === 'shoes' && readBack.find((c) => c.id === 'clothing').label === 'Kids wear' &&
        readBack[readBack.length - 1].id === 'toys' && savedCats.length === readBack.length, JSON.stringify(readBack.slice(0, 2)));
    r = await catPut(shoesFirst.filter((c) => c.id !== 'clothing'), auth);
    check('a category that still has products cannot be deleted', r.status === 400 && /Move or remove the \d+ products? in "Kids wear"/.test((await r.json()).error || ''), `status ${r.status}`);
    r = await catPut(shoesFirst.filter((c) => c.id !== 'toys'), auth);
    check('an empty category can be deleted', r.status === 200 && !(await r.json()).some((c) => c.id === 'toys'));
    r = await catPut([{ id: 'Bad Key!', label: 'x' }], auth);
    check('a malformed category key is refused', r.status === 400, `status ${r.status}`);
    r = await catPut([{ id: 'shoes', label: 'A' }, { id: 'shoes', label: 'B' }], auth);
    check('a category listed twice is refused', r.status === 400, `status ${r.status}`);
    r = await catPut(seededCats.map((c) => ({ id: c.id, label: c.label })), auth);
    check('the original categories are restored', r.status === 200 && (await r.json())[1].label === 'Clothing');

    // ---- a product deleted after it went in a cart ----
    r = await fetch(`${BASE}/api/orders`, json('POST', { customer_name: 'Gone Item', customer_phone: '0241110000', order_type: 'retail', items: [{ id: 999999, size: 'One Size', quantity: 1 }] }));
    const goneBody = await r.json();
    check('ordering a product that no longer exists says so (400), not a server error', r.status === 400 && /no longer sold/.test(goneBody.error || ''), `status ${r.status} ${goneBody.error}`);

    // ---- the admin's order poll: only what changed ----
    r = await fetch(`${BASE}/api/orders`, { headers: auth });
    const cursor = r.headers.get('x-orders-cursor');
    const fullCount = (await r.json()).length;
    check('every orders response carries the cursor for the next poll', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cursor || ''), cursor);
    r = await fetch(`${BASE}/api/orders?since=2099-01-01%2000:00:00`, { headers: auth });
    check('nothing has changed since a future moment', r.status === 200 && (await r.json()).length === 0);
    r = await fetch(`${BASE}/api/orders`, json('POST', { customer_name: 'Poll Check', customer_phone: '0241110002', order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }] }));
    const polled = await r.json();
    r = await fetch(`${BASE}/api/orders?since=${encodeURIComponent(cursor)}`, { headers: auth });
    const changes = await r.json();
    check('the poll returns the new order with its items, and only orders made or changed since the cursor',
        changes.some((o) => o.order_number === polled.order_number && o.items.length === 1) &&
        changes.every((o) => String(o.created_at) >= cursor || String(o.updated_at) >= cursor), `${changes.length} of ${fullCount + 1}`);
    r = await fetch(`${BASE}/api/orders?since=yesterday`, { headers: auth });
    check('a malformed poll cursor is refused', r.status === 400, `status ${r.status}`);

    // ---- wholesale: per-piece discount, MOQ floor ----
    const settings = await (await fetch(`${BASE}/api/settings`)).json();
    check('store settings use evergreen preorder messaging',
        settings.banner_text === 'China Pre-Orders are open! Message us on WhatsApp for the current closing date.');
    const moq = settings.wholesale_moq;
    const disc = settings.wholesale_discount;

    // ---- announcement run dates ----
    const settingsWith = (dates) => json('PUT', Object.assign({}, settings, dates), auth);
    r = await fetch(`${BASE}/api/settings`, settingsWith({ banner_starts: '2026-02-30', banner_ends: '' }));
    check('an announcement date that is not a real day is rejected', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/settings`, settingsWith({ banner_starts: '2026-10-31', banner_ends: '2026-10-17' }));
    check('an announcement cannot end before it starts', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/settings`, settingsWith({ banner_starts: '2026-10-17', banner_ends: '2026-10-31' }));
    const datedSettings = await (await fetch(`${BASE}/api/settings`)).json();
    check('announcement run dates are saved and served to the storefront',
        r.status === 200 && datedSettings.banner_starts === '2026-10-17' && datedSettings.banner_ends === '2026-10-31');
    const unitWs = Math.round(unitRetail * (1 - disc / 100) * 100) / 100;

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: 1, quantity: moq, size: sizeLabel }]
    }));
    const wsOrder = await r.json();
    check(`wholesale total = discounted unit x MOQ (${unitWs} x ${moq})`,
        r.status === 200 && close(wsOrder.total_amount, unitWs * moq), `got ${wsOrder.total_amount}`);

    // Under the MOQ the piece is charged at retail rather than refused (ADR 0010),
    // so a buyer can take the last few of a piece and keep bulk prices on the rest.
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: 1, quantity: moq - 1, size: sizeLabel }]
    }));
    const underMoq = await r.json();
    check(`wholesale below MOQ is charged at retail, not refused (${unitRetail} x ${moq - 1})`,
        r.status === 200 && close(underMoq.total_amount, unitRetail * (moq - 1)), `status ${r.status}, got ${underMoq.total_amount}`);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Bulk Buyer', customer_phone: '0242222222',
        order_type: 'wholesale', items: [{ id: 1, quantity: moq, size: sizeLabel }, { id: 1, quantity: 2, size: sizeLabel }]
    }));
    const mixedWs = await r.json();
    check(`one wholesale order mixes bulk lines and retail lines (${unitWs} x ${moq} + ${unitRetail} x 2)`,
        r.status === 200 && close(mixedWs.total_amount, unitWs * moq + unitRetail * 2), `status ${r.status}, got ${mixedWs.total_amount}`);

    // ---- the China pre-order window (DC Sourcing & Logistics) ----
    const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const earlyPreorder = { customer_name: 'Early Bird', customer_phone: '0243333300', order_type: 'preorder', items: [{ id: 1, quantity: 1, size: sizeLabel }] };
    await dbRun('UPDATE store_settings SET preorder_starts = NULL, preorder_ends = NULL WHERE id = 1');
    r = await fetch(`${BASE}/api/orders`, json('POST', earlyPreorder));
    check('with no pre-order window set, the shop takes no pre-orders', r.status === 400 && /closed/i.test((await r.json()).error), `status ${r.status}`);
    await dbRun('UPDATE store_settings SET preorder_starts = ?, preorder_ends = ? WHERE id = 1', [isoDay(-10), isoDay(-1)]);
    r = await fetch(`${BASE}/api/orders`, json('POST', earlyPreorder));
    check('after the window closes, pre-order checkout is refused', r.status === 400, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders`, json('POST', earlyPreorder, auth));
    check('staff can still take a pre-order at the counter outside the window', r.status === 200, `status ${r.status}`);
    const currentSettings = await (await fetch(`${BASE}/api/settings`)).json();
    const putSettings = (changes) => fetch(`${BASE}/api/settings`, json('PUT', Object.assign({}, currentSettings, changes), auth));
    r = await putSettings({ preorder_starts: isoDay(5), preorder_ends: isoDay(1) });
    check('a pre-order window cannot close before it opens', r.status === 400, `status ${r.status}`);
    r = await putSettings({ preorder_starts: isoDay(-1), preorder_ends: isoDay(20), whatsapp_group_url: 'https://collector.example.com/join' });
    check('only a real WhatsApp group invite is accepted as the group link', r.status === 400, `status ${r.status}`);
    r = await putSettings({ preorder_starts: isoDay(-1), preorder_ends: isoDay(20), whatsapp_group_url: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' });
    const openSettings = await (await fetch(`${BASE}/api/settings`)).json();
    check('the owner sets the window and group link in admin settings', r.status === 200 &&
        openSettings.preorder_ends === isoDay(20) && openSettings.whatsapp_group_url === 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv');
    r = await putSettings({ preorder_starts: isoDay(-1), preorder_ends: isoDay(20), whatsapp_group_url: 'https://chat.whatsapp.com/BS1xp5EZI5T9d7Pc6aMPmu?s=cl&p=a&mlu=4&ilr=4' });
    check('a group link pasted from WhatsApp\'s share sheet is saved without its tracking', r.status === 200 &&
        (await (await fetch(`${BASE}/api/settings`)).json()).whatsapp_group_url === 'https://chat.whatsapp.com/BS1xp5EZI5T9d7Pc6aMPmu');

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
    const bulkPreUnder = await r.json();
    check('a bulk pre-order line below the MOQ is charged at retail',
        r.status === 200 && close(bulkPreUnder.total_amount, unitRetail * (moq - 1)), `status ${r.status}, got ${bulkPreUnder.total_amount}`);

    const orderSlides = (kind, quantity, headers) => fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Slide Reseller', customer_phone: '0243333336', order_type: 'preorder', preorder_kind: kind,
        items: [{ id: slides.id, quantity, size: slides.size }]
    }, headers));
    r = await orderSlides('bulk', moq);
    const bulkSlides = await r.json();
    check(`a piece's own bulk price wins over the store-wide discount (150 x ${moq})`,
        r.status === 200 && close(bulkSlides.total_amount, 150 * moq), `got ${bulkSlides.total_amount}`);
    r = await orderSlides('shop', 1);
    const oneSlide = await r.json();
    check('one piece still costs the selling price', r.status === 200 && close(oneSlide.total_amount, 180), `got ${oneSlide.total_amount}`);
    await dbRun('UPDATE store_settings SET wholesale_enabled = 0 WHERE id = 1');
    try {
        r = await orderSlides('bulk', moq);
        check('with wholesale switched off, the shop takes no bulk pre-orders', r.status === 400, `status ${r.status}`);
        r = await fetch(`${BASE}/api/orders`, json('POST', {
            customer_name: 'Bulk Buyer', customer_phone: '0242222222', order_type: 'wholesale', items: [{ id: 1, quantity: moq, size: sizeLabel }]
        }));
        check('with wholesale switched off, the shop takes no wholesale orders', r.status === 400, `status ${r.status}`);
        r = await orderSlides('bulk', moq, auth);
        check('staff can still sell in bulk at the counter with wholesale off', r.status === 200, `status ${r.status}`);
    } finally {
        // Back on even if a check above throws, so later wholesale checks report their own result.
        await dbRun('UPDATE store_settings SET wholesale_enabled = 1 WHERE id = 1');
    }

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

    // ---- stock follows the order: off once when paid or later, back when it leaves those ----
    r = await fetch(`${BASE}/api/products`, json('POST', { name: 'Stock Ledger Tee', price: 50, stock: 10, cat: 'clothing', size: 'One size', img: 'images/placeholder.svg' }, auth));
    const ledgerId = (await r.json()).id;
    const ledgerStock = async () => (await dbGet('SELECT stock FROM products WHERE id = ?', [ledgerId])).stock;
    const ledgerOrder = async () => {
        const placed = await (await fetch(`${BASE}/api/orders`, json('POST', {
            customer_name: 'Ledger Buyer', customer_phone: '0243333340', order_type: 'retail', items: [{ id: ledgerId, quantity: 2, size: 'One size' }]
        }))).json();
        return (await dbGet('SELECT id FROM orders WHERE order_number = ?', [placed.order_number])).id;
    };
    const setOrderStatus = (id, status) => fetch(`${BASE}/api/orders/${id}`, json('PUT', { status }, auth));
    const ledgerFirst = await ledgerOrder();
    await setOrderStatus(ledgerFirst, 'paid');
    check('marking an order paid takes its pieces off the shelf', (await ledgerStock()) === 8, `stock ${await ledgerStock()}`);
    await setOrderStatus(ledgerFirst, 'shipped');
    await setOrderStatus(ledgerFirst, 'paid');
    check('setting a shipped order back to paid does not take its pieces twice', (await ledgerStock()) === 8, `stock ${await ledgerStock()}`);
    await setOrderStatus(ledgerFirst, 'cancelled');
    check('cancelling a paid order puts its pieces back', (await ledgerStock()) === 10, `stock ${await ledgerStock()}`);
    const ledgerSecond = await ledgerOrder();
    await setOrderStatus(ledgerSecond, 'delivered');
    check('an order marked delivered without passing paid still takes its pieces', (await ledgerStock()) === 8, `stock ${await ledgerStock()}`);
    await fetch(`${BASE}/api/users`, json('POST', { full_name: 'Counter Staff', email: 'counter@test.com', role: 'staff' }, auth));
    const counterLogin = await (await googleSignIn('counter@test.com')).json();
    r = await fetch(`${BASE}/api/orders/${ledgerSecond}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${counterLogin.accessToken}` } });
    check('staff cannot delete an order; that needs a manager', r.status === 403, `status ${r.status}`);
    r = await fetch(`${BASE}/api/orders/${ledgerSecond}`, { method: 'DELETE', headers: auth });
    check('deleting a delivered order puts its pieces back', r.status === 200 && (await ledgerStock()) === 10, `status ${r.status}, stock ${await ledgerStock()}`);
    const slidesStockBefore = (await dbGet('SELECT stock FROM products WHERE id = ?', [slides.id])).stock;
    const bulkSlidesRow = await dbGet('SELECT id FROM orders WHERE order_number = ?', [bulkSlides.order_number]);
    await setOrderStatus(bulkSlidesRow.id, 'paid');
    check('paying for a pre-order leaves the pre-order piece\'s count alone',
        (await dbGet('SELECT stock FROM products WHERE id = ?', [slides.id])).stock === slidesStockBefore, `stock ${slidesStockBefore}`);

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
    check('shop CSP allows the helper Firebase needs for Google sign-in',
        /script-src[^;]*https:\/\/apis\.google\.com/.test(storeCsp), storeCsp);
    check('shop CSP allows the Firebase sign-in frame',
        /frame-src[^;]*https:\/\/\*\.firebaseapp\.com/.test(storeCsp), storeCsp);

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

    // The admin's payment insight reads the method the server recorded, and an
    // order with none on record is reported as such rather than given one.
    const mapStart = adminSource.indexOf('function mapServerOrder');
    const mapEnd = adminSource.indexOf('function fetchOrdersFromServer');
    const rankStart = adminSource.indexOf('function topPaymentMethod');
    const rankEnd = adminSource.indexOf('function buildLocalAnalytics');
    check('admin.js still carries the order mapper and the payment-method ranking',
        mapStart !== -1 && mapEnd > mapStart && rankStart !== -1 && rankEnd > rankStart);
    const insight = {};
    vm.createContext(insight);
    vm.runInContext(adminSource.slice(mapStart, mapEnd) + adminSource.slice(rankStart, rankEnd), insight);
    check('the admin keeps the payment method the server sends',
        insight.mapServerOrder({ id: 1, order_number: 'ORD-1', payment: { payment_method: 'WhatsApp' }, items: [] }).paymentMethod === 'WhatsApp');
    check('an order the server sends with no payment has no method in the admin',
        !insight.mapServerOrder({ id: 1, order_number: 'ORD-1', payment: null, items: [] }).paymentMethod);
    const noneRecorded = insight.topPaymentMethod([{ total: 100 }, { total: 50 }]);
    check('orders with no recorded method are reported as not recorded',
        noneRecorded.label === 'Not recorded' && noneRecorded.share === 100, JSON.stringify(noneRecorded));
    const mixedMethods = insight.topPaymentMethod([{ total: 30, paymentMethod: 'Cash' }, { total: 70, paymentMethod: 'WhatsApp' }]);
    check('the top payment method is the one carrying the most money',
        mixedMethods.label === 'WhatsApp' && mixedMethods.share === 70, JSON.stringify(mixedMethods));
    check('with no orders there is no top payment method',
        insight.topPaymentMethod([]).label === 'No payments yet');

    // Opening Settings re-applies the saved accent colour. A stray `else` once
    // tied that call to the products widget toggle being absent, so adding the
    // toggle back would have silently stopped it.
    const settingsStart = adminSource.indexOf('function loadSettingsTab');
    const settingsEnd = adminSource.lastIndexOf('/*', adminSource.indexOf('ORDER ALERTS ON THIS DEVICE'));
    check('admin.js still carries the Settings loader', settingsStart !== -1 && settingsEnd > settingsStart);
    const settingsTab = {
        appliedAccent: null,
        getSettings: () => ({ darkMode: false, accentColor: '#123456', profile: {}, notifications: {},
            widgets: { revenue: true, inventory: true, activity: true, products: true } }),
        refreshPushAlerts: () => {},
        applyAccentColor: (color) => { settingsTab.appliedAccent = color; },
        document: { getElementById: () => ({}) }
    };
    vm.createContext(settingsTab);
    vm.runInContext(adminSource.slice(settingsStart, settingsEnd), settingsTab);
    settingsTab.loadSettingsTab();
    check('opening Settings applies the saved accent colour even with every widget toggle on the page',
        settingsTab.appliedAccent === '#123456', `applied ${settingsTab.appliedAccent}`);

    // Inventory counts what is on the shelf; pre-order pieces have no stock.
    const inventoryStart = adminSource.indexOf('function getFilteredInventory');
    const inventoryEnd = adminSource.indexOf('function sortInventory');
    const preorderTestStart = adminSource.indexOf('function isPreorderProduct');
    const preorderTestEnd = adminSource.indexOf('\n', preorderTestStart);
    check('admin.js still carries the Inventory filter and the pre-order test',
        inventoryStart !== -1 && inventoryEnd > inventoryStart && preorderTestStart !== -1);
    const inventoryTab = {
        globalProducts: [
            { id: 1, name: 'Romper', cat: 'clothing', stock: 4, fulfillment_type: 'in_stock' },
            { id: 2, name: 'School bag', cat: 'accessories', stock: 0, fulfillment_type: 'preorder' },
            { id: 3, name: 'Old row', cat: 'clothing', stock: 0 }
        ],
        document: { querySelector: () => null, getElementById: () => null }
    };
    vm.createContext(inventoryTab);
    vm.runInContext(adminSource.slice(inventoryStart, inventoryEnd) + adminSource.slice(preorderTestStart, preorderTestEnd), inventoryTab);
    const inventoryIds = inventoryTab.getFilteredInventory().map((p) => p.id);
    check('Inventory lists the pieces the shop holds and leaves pre-order pieces to Pre-orders',
        JSON.stringify(inventoryIds) === '[1,3]', JSON.stringify(inventoryIds));
    check('Inventory has no listing-type filter, since only held pieces are listed, and links to Pre-orders',
        !adminPageSource.includes('id="inv-fulfillment-filter"') &&
        adminPageSource.includes('onclick="switchTab(\'tab-preorders\')">Pre-order pieces</button>'));

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
    // Image sizes read from the files themselves (PNG IHDR; lossless WebP VP8L header).
    const imageSize = (file) => {
        const b = fs.readFileSync(path.join(__dirname, '..', file));
        if (b.slice(1, 4).toString() === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 };
        if (b.slice(12, 16).toString() === 'VP8L') {
            const bits = b.readUInt32LE(21);
            return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
        }
        return null;
    };
    const layerSizes = splashLayers.map((name) => imageSize(`brand/splash-${name}.webp`));
    check('the launch screen layers share one canvas, so they stack exactly, at the size the admin declares',
        layerSizes.every((s) => s && s.w === 1086 && s.h === 1378) &&
        adminHtmlForSplash.includes('width="1086" height="1378"') && adminHtmlForSplash.includes('aspect-ratio: 543 / 689'),
        JSON.stringify(layerSizes));
    // A phone draws its own loading screen from the manifest's icons. Each must
    // be the size it claims, square, and maskable icons separate from the plain
    // ones (a maskable icon is cropped, so the logo has to sit in its safe zone).
    ['manifest.json', 'admin.manifest.json'].forEach((file) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
        const icons = manifest.icons || [];
        const wrong = icons.filter((icon) => {
            const size = fs.existsSync(path.join(__dirname, '..', icon.src)) ? imageSize(icon.src) : null;
            return !size || `${size.w}x${size.h}` !== icon.sizes || size.w !== size.h;
        }).map((icon) => icon.src);
        check(`${file} lists square icons that exist at the sizes it claims`, icons.length > 0 && wrong.length === 0, wrong.join(', '));
        check(`${file} keeps maskable icons apart from the plain ones`,
            icons.some((icon) => icon.purpose === 'maskable') && icons.some((icon) => icon.purpose === 'any') &&
            !icons.some((icon) => /any/.test(icon.purpose) && /maskable/.test(icon.purpose)));
        check(`${file} gives the plain icons a transparent background and the maskable ones a solid one`,
            icons.every((icon) => imageSize(icon.src).alpha === (icon.purpose === 'any')));
    });
    check('the home-screen icon on iPhone is a solid square',
        ['index.html', 'admin.html'].every((page) => fs.readFileSync(path.join(__dirname, '..', page), 'utf8').includes('<link rel="apple-touch-icon" href="brand/apple-touch-icon.png">')) &&
        (() => { const s = imageSize('brand/apple-touch-icon.png'); return s.w === 180 && s.h === 180 && !s.alpha; })());

    // ---- what the owner is emailed ----
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: '<b>Ama</b> Email', customer_phone: '0249000123', order_type: 'retail',
        delivery_address: { line1: '5 Ring Road', city: 'Kasoa', region: 'Central' },
        items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const emailedOrder = await r.json();
    const orderEmail = await waitForEmail((m) => m.subject.includes(emailedOrder.order_number));
    check('a new order emails the owner', !!orderEmail && orderEmail.to === 'owner@test.com', JSON.stringify(orderEmail && orderEmail.to));
    check('the order email gives the total in its subject',
        !!orderEmail && orderEmail.subject.includes('GH₵ ' + Number(emailedOrder.total_amount).toFixed(2)), orderEmail && orderEmail.subject);
    const firstProductName = (await dbGet('SELECT name FROM products WHERE id = 1')).name;
    check('the order email lists what was ordered and where it goes',
        !!orderEmail && orderEmail.html.includes(firstProductName) && orderEmail.html.includes('5 Ring Road'));
    check('the order email shows what the customer typed as text, never as markup',
        !!orderEmail && orderEmail.html.includes('&lt;b&gt;Ama&lt;/b&gt;') && !orderEmail.html.includes('<b>Ama</b>'));
    check('every shop email carries the DC Kids logo',
        !!orderEmail && orderEmail.html.includes('/brand/apple-touch-icon.png') && orderEmail.html.includes('alt="DC Kids"'));
    check('a customer who gives no email is not emailed',
        !emailed.some((m) => m.subject === 'Your DC Kids order ' + emailedOrder.order_number));

    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Efua Confirm', customer_phone: '0249000124', customer_email: 'efua.customer@example.com', order_type: 'retail',
        delivery_address: { line1: '7 Ring Road', city: 'Kasoa', region: 'Central' },
        items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }));
    const confirmedOrder = await r.json();
    const confirmation = await waitForEmail((m) => m.subject === 'Your DC Kids order ' + confirmedOrder.order_number);
    check('a customer who gives an email gets an order confirmation', !!confirmation && confirmation.to === 'efua.customer@example.com',
        JSON.stringify(confirmation && confirmation.to));
    check('the confirmation gives the total', !!confirmation && confirmation.html.includes('GH₵ ' + Number(confirmedOrder.total_amount).toFixed(2)));
    check('the confirmation links to tracking for that order',
        !!confirmation && confirmation.html.includes('track.html?order=' + encodeURIComponent(confirmedOrder.order_number)));
    check('the confirmation leaves out the phone number and address',
        !!confirmation && !confirmation.html.includes('0249000124') && !confirmation.html.includes('7 Ring Road'));
    check('the confirmation carries the DC Kids logo', !!confirmation && confirmation.html.includes('alt="DC Kids"'));

    const unpaidNow = (await dbGet(`SELECT COUNT(*) AS c FROM orders WHERE lower(COALESCE(status, '')) IN ('pending', 'awaiting_payment', 'payment_review')`)).c;
    const lowNow = (await dbGet('SELECT COUNT(*) AS c FROM products WHERE stock > 0 AND stock <= 5')).c;
    const summaryResult = await app.sendMorningSummary();
    const summaryEmail = emailed.filter((m) => m.subject.startsWith('DC Kids this morning')).pop();
    check('the morning summary goes to the owner', !!summaryEmail && summaryEmail.to === 'owner@test.com');
    check('the morning summary counts the orders waiting on payment as the dashboard does', summaryResult.unpaid === unpaidNow, `${summaryResult.unpaid} vs ${unpaidNow}`);
    check('the morning summary counts the pieces running low as the dashboard does', summaryResult.low === lowNow, `${summaryResult.low} vs ${lowNow}`);
    check('the morning summary leads with the unpaid orders',
        !!summaryEmail && summaryEmail.subject.includes(`${unpaidNow} order`), summaryEmail && summaryEmail.subject);
    check('the morning summary is due later the same day before 7am',
        app.msUntilMorningSummary(new Date('2026-11-04T06:30:00Z')) === 30 * 60 * 1000);
    check('the morning summary at exactly 7am waits a full day for the next one',
        app.msUntilMorningSummary(new Date('2026-11-04T07:00:00Z')) === 24 * 60 * 60 * 1000);
    check('the morning summary after 7am is due the next morning',
        app.msUntilMorningSummary(new Date('2026-11-04T20:00:00Z')) === 11 * 60 * 60 * 1000);

    // ---- signing out ends the session on the server ----
    const signInToken = async (email) => (await (await googleSignIn(email)).json()).accessToken;
    const asA = { Authorization: 'Bearer ' + await signInToken('owner@test.com') };
    const asB = { Authorization: 'Bearer ' + await signInToken('owner@test.com') };
    const asC = { Authorization: 'Bearer ' + await signInToken('owner@test.com') };
    check('a fresh sign-in reads admin data', (await fetch(`${BASE}/api/me`, { headers: asA })).status === 200);
    r = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: asA });
    check('logging out answers ok', r.status === 200, `status ${r.status}`);
    r = await fetch(`${BASE}/api/me`, { headers: asA });
    check('a logged-out session is refused even if its token was copied', r.status === 403, `status ${r.status}`);
    check('logging out ends only that session', (await fetch(`${BASE}/api/me`, { headers: asB })).status === 200);
    r = await fetch(`${BASE}/api/orders`, json('POST', {
        customer_name: 'Counter After Logout', customer_phone: '0249000777', order_type: 'retail', items: [{ id: 1, quantity: 1, size: sizeLabel }]
    }, asA));
    check('a logged-out session cannot place counter orders as staff', r.status === 403, `status ${r.status}`);
    const ownerForForgery = await dbGet("SELECT id FROM users WHERE email = 'owner@test.com'");
    const neverSignedIn = require('jsonwebtoken').sign({ id: ownerForForgery.id, username: 'owner@test.com', role: 'manager' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    r = await fetch(`${BASE}/api/me`, { headers: { Authorization: 'Bearer ' + neverSignedIn } });
    check('a correctly signed token that was never a sign-in is refused', r.status === 403, `status ${r.status}`);
    r = await fetch(`${BASE}/api/auth/logout-all`, { method: 'POST', headers: asB });
    check('signing out of all devices answers ok', r.status === 200, `status ${r.status}`);
    const bAfter = (await fetch(`${BASE}/api/me`, { headers: asB })).status;
    const cAfter = (await fetch(`${BASE}/api/me`, { headers: asC })).status;
    check('signing out of all devices ends every session', bAfter === 403 && cAfter === 403, `${bAfter} ${cAfter}`);
    check('order alerts promise only what the shop sends: new orders, not online payments',
        !adminHtml.includes('paid online'));
    check('the admin offers a way to sign out of all devices',
        adminHtml.includes('onclick="signOutAllDevices()"') && adminSource.includes("'/auth/logout-all'") && adminSource.includes("'/auth/logout'"));

    console.log(`\n${passed} passed, ${failed} failed`);
    cleanupDb();
    process.exit(failed ? 1 : 0);
}

run().catch(err => {
    console.error('FATAL:', err);
    cleanupDb();
    process.exit(1);
});
