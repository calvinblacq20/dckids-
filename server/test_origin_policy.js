// Production CORS: the shop's own requests pass on every hostname that serves
// it, listed origins pass, and any other site gets a 403 (never a 500).
// Boots the real server in production mode on a throwaway data directory.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { originAllowed } = require('./origin_policy');

let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        console.error(`  FAIL  ${name} — ${error.message}`);
        process.exitCode = 1;
    }
}

const LISTED = ['https://dckidsbrand.com'];
check('a request with no Origin passes (same-origin GET, webhooks, server-to-server)', () =>
    assert.strictEqual(originAllowed(undefined, 'dckidsbrand.com', LISTED), true));
check('a listed origin passes', () => assert.strictEqual(originAllowed('https://dckidsbrand.com', 'api.example', LISTED), true));
check('the shop\'s own page passes on a hostname that is not listed (www, the host\'s domain)', () => {
    assert.strictEqual(originAllowed('https://www.dckidsbrand.com', 'www.dckidsbrand.com', LISTED), true);
    assert.strictEqual(originAllowed('https://dckids.up.railway.app', 'DCKIDS.up.railway.app', LISTED), true);
});
check('another site is refused, even one that differs only by subdomain or port', () => {
    assert.strictEqual(originAllowed('https://evil.example', 'dckidsbrand.com', LISTED), false);
    assert.strictEqual(originAllowed('https://www.dckidsbrand.com', 'dckidsbrand.com', LISTED), false);
    assert.strictEqual(originAllowed('https://dckidsbrand.com:8443', 'dckidsbrand.com', []), false);
});
check('an opaque or malformed Origin is refused', () => {
    assert.strictEqual(originAllowed('null', 'dckidsbrand.com', LISTED), false);
    assert.strictEqual(originAllowed('not a url', 'dckidsbrand.com', LISTED), false);
    assert.strictEqual(originAllowed('https://evil.example', '', LISTED), false);
});

async function live() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dckids-origin-'));
    const port = 38000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [path.join(__dirname, 'start_server.js')], {
        env: {
            PATH: process.env.PATH,
            NODE_ENV: 'production',
            PORT: String(port),
            DATA_DIR: dataDir,
            JWT_SECRET: 'origin-policy-test-secret-0123456789abcdef',
            ALLOWED_ORIGINS: 'https://dckidsbrand.com',
            APP_URL: 'https://dckidsbrand.com',
            OWNER_EMAIL: 'owner@dckidsbrand.com',
            RESEND_API_KEY: 're_test_placeholder',
            RESEND_FROM: 'DC Kids <orders@dckidsbrand.com>'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    try {
        const started = Date.now();
        while (!/Server running on port/.test(output)) {
            if (Date.now() - started > 30000) throw new Error('server did not start:\n' + output);
            if (child.exitCode !== null) throw new Error('server exited:\n' + output);
            await new Promise((r) => setTimeout(r, 200));
        }
        // http.request, not fetch: fetch will not send a Host header of our choosing,
        // and the hostname the browser used is exactly what this checks.
        const order = (origin, host) => new Promise((resolve, reject) => {
            const body = JSON.stringify({ customer_name: 'Origin Check', customer_phone: '0241000000', order_type: 'retail', items: [{ id: 8, size: 'One Size', quantity: 1 }] });
            const req = http.request({
                host: '127.0.0.1', port, path: '/api/orders', method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Host: host }, origin ? { Origin: origin } : {})
            }, (res) => {
                let text = '';
                res.on('data', (d) => { text += d; });
                res.on('end', () => resolve({ status: res.statusCode, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
            });
            req.on('error', reject);
            req.end(body);
        });
        const listed = await order('https://dckidsbrand.com', 'dckidsbrand.com');
        const www = await order('https://www.dckidsbrand.com', 'www.dckidsbrand.com');
        const foreign = await order('https://evil.example', 'dckidsbrand.com');
        const foreignBody = foreign.body;
        check('in production, an order from the listed address is saved', () => assert.strictEqual(listed.status, 200));
        check('in production, the shop\'s own order on an unlisted hostname (www) is saved', () => assert.strictEqual(www.status, 200));
        check('in production, another site is refused with a 403, not a server error', () => {
            assert.strictEqual(foreign.status, 403);
            assert.match(foreignBody.error || '', /not allowed/i);
        });
    } finally {
        child.kill('SIGTERM');
        await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

live()
    .catch((error) => { console.error(`  FAIL  production boot — ${error.message}`); process.exitCode = 1; })
    .finally(() => console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ', 0 failed'}`));
