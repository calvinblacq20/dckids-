// A long order history: the admin's order list must keep working past 32,766
// orders (SQLite's limit on bound variables in one statement, which the list
// used to hit with one variable per order), and the 45-second poll must fetch
// only what changed. Boots the real server on a throwaway database.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');

const HISTORY = 33000;
const JWT_SECRET = 'order-history-test-secret-0123456789abcdef';
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dckids-history-'));
const dbPath = path.join(dir, 'history.db');
const port = 39000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${port}`;
const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

function exec(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); }));
}

// The owner's account as her first Google sign-in would create it. Google
// can't be reached from a test, so her session token is signed directly.
async function ownerSession() {
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 10000);
    const owner = await exec(db, `INSERT INTO users (username, role, email, full_name, status, created_at)
        VALUES ('owner@dckidsbrand.com', 'manager', 'owner@dckidsbrand.com', 'History Owner', 'active', datetime('now'))`);
    await new Promise((resolve) => db.close(resolve));
    return jwt.sign({ id: owner.lastID, username: 'owner@dckidsbrand.com', role: 'manager' }, JWT_SECRET, { expiresIn: '1h' });
}

async function fillHistory() {
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 10000);
    await exec(db, 'BEGIN');
    const order = db.prepare(`INSERT INTO orders (order_number, customer_name, customer_phone, order_type, total_amount, status, source, created_at, updated_at)
        VALUES (?, 'History Buyer', ?, 'retail', 97, 'completed', 'storefront', datetime('now', '-30 days'), datetime('now', '-30 days'))`);
    const item = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price_at_time) VALUES (?, 8, ?, 1, 97)');
    const payment = db.prepare("INSERT INTO payments (order_id, payment_method, amount, status) VALUES (?, 'Mobile Money', 97, 'paid')");
    const run = (stmt, params) => new Promise((resolve, reject) => stmt.run(params, function (err) { if (err) reject(err); else resolve(this); }));
    for (let i = 0; i < HISTORY; i++) {
        const o = await run(order, ['HIST-' + i, '0240' + String(100000 + i)]);
        await run(item, [o.lastID, 'Baby Romper (0-3M)']);
        if (i % 3 === 0) await run(payment, [o.lastID]);
    }
    [order, item, payment].forEach((stmt) => stmt.finalize());
    await exec(db, 'COMMIT');
    await new Promise((resolve) => db.close(resolve));
}

async function main() {
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
        env: {
            PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), DB_PATH: dbPath,
            JWT_SECRET, OWNER_EMAIL: 'owner@dckidsbrand.com',
            RESEND_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: ''
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
        const auth = { Authorization: 'Bearer ' + await ownerSession() };

        await fillHistory();

        let r = await fetch(BASE + '/api/orders', { headers: auth });
        const cursor = r.headers.get('x-orders-cursor');
        const all = r.status === 200 ? await r.json() : [];
        check(`the admin's order list loads with ${HISTORY.toLocaleString('en')} orders (it used to fail past 32,766)`, () => {
            assert.strictEqual(r.status, 200);
            assert.ok(all.length >= HISTORY, `${all.length} orders`);
        });
        check('every order still carries its items and its payment', () => {
            const sample = all.find((o) => o.order_number === 'HIST-0');
            assert.ok(sample && sample.items.length === 1 && sample.payment && sample.payment.status === 'paid');
            assert.ok(all.every((o) => Array.isArray(o.items)));
        });

        const fresh = await post('/api/orders', { customer_name: 'New Buyer', customer_phone: '0241000099', order_type: 'retail', items: [{ id: 8, size: '0 - 12M', quantity: 1 }] });
        r = await fetch(BASE + '/api/orders?since=' + encodeURIComponent(cursor), { headers: auth });
        const changes = await r.json();
        check('the 45-second poll returns just the new order, not the history', () => {
            assert.strictEqual(r.status, 200);
            assert.ok(changes.some((o) => o.order_number === fresh.order_number), JSON.stringify(fresh));
            assert.ok(changes.length < 10, `${changes.length} orders`);
        });
    } finally {
        child.kill('SIGTERM');
        await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main()
    .catch((error) => { console.error(`  FAIL  order history — ${error.message}`); process.exitCode = 1; })
    .finally(() => console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ', 0 failed'}`));
