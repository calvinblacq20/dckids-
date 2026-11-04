// Who the server thinks a visitor is, through Railway alone and with Cloudflare
// in front. Runs real Express so req.ip is resolved exactly as in production.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { shouldTrustProxy, isCloudflareAddress } = require('./trusted_proxies');

let passed = 0;
let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        failed++;
        console.error(`  FAIL  ${name} — ${error.message}`);
        process.exitCode = 1;
    }
}

function ipSeenFor(port, forwardedFor) {
    return new Promise((resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port, path: '/ip', headers: { 'X-Forwarded-For': forwardedFor } }, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve(body));
        });
        request.on('error', reject);
    });
}

async function run() {
    await check('a Cloudflare IPv4 address is recognised', () =>
        assert.strictEqual(isCloudflareAddress('104.16.0.1'), true));
    await check('a Cloudflare IPv6 address is recognised', () =>
        assert.strictEqual(isCloudflareAddress('2606:4700::1'), true));
    await check('a Cloudflare address written as IPv4-mapped IPv6 is recognised', () =>
        assert.strictEqual(isCloudflareAddress('::ffff:104.16.0.1'), true));
    await check('an ordinary address is not Cloudflare', () =>
        assert.strictEqual(isCloudflareAddress('203.0.113.5'), false));
    await check('something that is not an address is not Cloudflare', () =>
        assert.strictEqual(isCloudflareAddress('not-an-ip'), false));
    await check('Cloudflare is not trusted further back than the hop behind Railway', () =>
        assert.strictEqual(shouldTrustProxy('104.16.0.1', 2), false));
    await check('the server resolves visitors with this rule', () =>
        assert.match(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), /app\.set\('trust proxy', shouldTrustProxy\)/));

    const app = express();
    app.set('trust proxy', shouldTrustProxy);
    app.get('/ip', (req, res) => res.send(req.ip));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const { port } = server.address();
    try {
        await check('a visitor reaching Railway directly is identified by their own address', async () =>
            assert.strictEqual(await ipSeenFor(port, '203.0.113.5'), '203.0.113.5'));
        await check('a visitor behind Cloudflare is identified by their own address, not Cloudflare\'s', async () =>
            assert.strictEqual(await ipSeenFor(port, '203.0.113.5, 104.16.0.1'), '203.0.113.5'));
        await check('a visitor behind Cloudflare over IPv6 is identified by their own address', async () =>
            assert.strictEqual(await ipSeenFor(port, '2001:db8::5, 2606:4700::1'), '2001:db8::5'));
        await check('an address forged ahead of a direct visitor is ignored', async () =>
            assert.strictEqual(await ipSeenFor(port, '198.51.100.9, 203.0.113.5'), '203.0.113.5'));
        await check('an address forged ahead of a Cloudflare visitor is ignored', async () =>
            assert.strictEqual(await ipSeenFor(port, '198.51.100.9, 203.0.113.5, 104.16.0.1'), '203.0.113.5'));
    } finally {
        server.close();
    }
    console.log(`\n${passed} passed, ${failed} failed`);
}

run();
