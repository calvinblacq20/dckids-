#!/usr/bin/env node
/**
 * Demo data for local work and for showing the admin to someone.
 *
 * The dashboard, analytics and reports screens are mostly charts and
 * rankings, and a fresh database has no orders at all, so every one of them
 * renders an empty state and the admin looks broken rather than empty. This
 * fills in suppliers, customers and roughly four months of orders so those
 * screens have something to draw.
 *
 * Everything it writes is tagged, so running it twice does not duplicate:
 *   orders        order_number starts with DEMO-
 *   customers     phone starts with +23320700
 *   suppliers     supplier_name ends with " (demo)"
 * Run with --reset to delete what a previous run inserted first.
 *
 * It refuses to touch a production database. This is a development utility;
 * it is never imported by the server.
 */
const path = require('path');
const sqlite3 = require('sqlite3');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DEMO_ORDER_PREFIX = 'DEMO-';
const DEMO_PHONE_PREFIX = '+23320700';
const DEMO_SUPPLIER_SUFFIX = ' (demo)';
const DAYS_OF_HISTORY = 120;

if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('Refusing to run: NODE_ENV is production. This writes fake orders.');
    process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'inventory.db');
const RESET = process.argv.includes('--reset');

// A fixed stream so two runs of the same script produce the same shop.
let seed = 20261010;
function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST_NAMES = ['Ama', 'Kwame', 'Akosua', 'Yaw', 'Abena', 'Kofi', 'Adwoa', 'Kwesi',
    'Efua', 'Kojo', 'Esi', 'Yaa', 'Nana', 'Afia', 'Kwabena', 'Araba',
    'Serwaa', 'Kuukua', 'Fiifi', 'Maame'];
const LAST_NAMES = ['Mensah', 'Boateng', 'Owusu', 'Asante', 'Agyeman', 'Darko', 'Appiah',
    'Frimpong', 'Addo', 'Nyarko', 'Danso', 'Acheampong', 'Baidoo', 'Quartey'];
const AREAS = ['East Legon', 'Osu', 'Tema', 'Madina', 'Spintex', 'Achimota', 'Adenta',
    'Dansoman', 'Kasoa', 'Takoradi', 'Kumasi', 'Cape Coast'];
const PAYMENT_METHODS = ['Mobile Money', 'Mobile Money', 'Mobile Money', 'Bank Transfer', 'Cash on Delivery'];

// Weighted so most history is settled and a handful is still live, which is
// what the dashboard's "needs attention" counters are there to show.
const STATUS_MIX = [
    ...Array(26).fill('completed'),
    ...Array(14).fill('delivered'),
    ...Array(10).fill('paid'),
    ...Array(5).fill('shipped'),
    ...Array(4).fill('processing'),
    ...Array(3).fill('pending'),
    ...Array(2).fill('pending_deposit'),
    'cancelled'
];
const REVENUE_STATUSES = ['paid', 'shipped', 'dispatched', 'delivered', 'completed'];
const STOCK_HOLDING_STATUSES = ['pending', 'pending_deposit', 'awaiting_payment', 'payment_review', 'processing'];

const SUPPLIERS = [
    ['Accra Baby Textiles', 'Comfort Owusu', 'Kaneshie Market, Accra', 'Clothing, Bedding'],
    ['Guangzhou Kids Export', 'Li Wei', 'Baiyun District, Guangzhou', 'Clothing, Shoes, Accessories'],
    ['Tema Harbour Imports', 'Samuel Nkrumah', 'Community 1, Tema', 'Gear, Feeding'],
    ['Kumasi Bathcare Supply', 'Grace Adjei', 'Adum, Kumasi', 'Bathcare, Essentials'],
    ['Little Steps Footwear', 'Daniel Mensah', 'Spintex Road, Accra', 'Shoes'],
    ['Nursery Essentials Ltd', 'Patience Boateng', 'Dzorwulu, Accra', 'Newborn, Feeding'],
    ['Yiwu Trading Partners', 'Chen Hua', 'Yiwu, Zhejiang', 'Accessories, Gear']
];

const db = new sqlite3.Database(DB_PATH);
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

function isoDaysAgo(days, hour) {
    const d = new Date(Date.now() - days * 86400000);
    d.setHours(hour, between(0, 59), between(0, 59), 0);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function clearDemo() {
    const orders = await all(
        'SELECT id FROM orders WHERE order_number LIKE ?', [DEMO_ORDER_PREFIX + '%']);
    const ids = orders.map((o) => o.id);
    if (ids.length) {
        const marks = ids.map(() => '?').join(',');
        // Give the stock back before the rows go, so --reset leaves the
        // catalogue where it started rather than slowly draining it.
        const held = await all(
            `SELECT i.product_id AS pid, SUM(i.quantity) AS qty
               FROM order_items i JOIN orders o ON o.id = i.order_id
              WHERE i.order_id IN (${marks})
                AND o.status NOT IN ('cancelled')
              GROUP BY i.product_id`, ids);
        for (const row of held) {
            await run('UPDATE products SET stock = stock + ? WHERE id = ?', [row.qty, row.pid]);
        }
        await run(`DELETE FROM payments WHERE order_id IN (${marks})`, ids);
        await run(`DELETE FROM order_items WHERE order_id IN (${marks})`, ids);
        await run(`DELETE FROM orders WHERE id IN (${marks})`, ids);
    }
    await run('DELETE FROM customers WHERE phone LIKE ?', [DEMO_PHONE_PREFIX + '%']);
    await run('DELETE FROM suppliers WHERE supplier_name LIKE ?', ['%' + DEMO_SUPPLIER_SUFFIX]);
    return ids.length;
}

async function main() {
    const existing = await get(
        'SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?', [DEMO_ORDER_PREFIX + '%']);
    if (existing.n > 0 && !RESET) {
        console.log(`${existing.n} demo orders are already here. Re-run with --reset to rebuild them.`);
        return;
    }
    if (RESET) {
        const removed = await clearDemo();
        console.log(`cleared ${removed} demo orders`);
    }

    const products = await all(
        'SELECT id, name, price, stock, cat FROM products WHERE price > 0 ORDER BY id');
    if (!products.length) throw new Error('no products in the catalogue to order');

    await run('BEGIN');
    try {
        for (const [name, contact, address, supplies] of SUPPLIERS) {
            const handle = name.toLowerCase().replace(/[^a-z]+/g, '.');
            await run(
                `INSERT OR IGNORE INTO suppliers
                   (supplier_name, contact_person, email, phone, business_address,
                    products_supplied, status, notes)
                 VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
                [name + DEMO_SUPPLIER_SUFFIX, contact, handle + '@example.com',
                    '+2332' + between(10000000, 99999999), address, supplies,
                    'Sample supplier for demonstration.']);
        }

        const customers = [];
        for (let i = 0; i < 26; i++) {
            const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
            const phone = DEMO_PHONE_PREFIX + String(100 + i);
            await run('INSERT OR IGNORE INTO customers (name, phone, email, created_at) VALUES (?, ?, ?, ?)',
                [name, phone, name.toLowerCase().replace(/\s+/g, '.') + '@example.com',
                    isoDaysAgo(between(DAYS_OF_HISTORY - 10, DAYS_OF_HISTORY), 10)]);
            customers.push({ name, phone });
        }

        // A few products sell far more than the rest, so "top products" and
        // "best selling category" have a real shape instead of a flat line.
        const bestSellers = [];
        for (let i = 0; i < 6; i++) bestSellers.push(pick(products));

        let made = 0;
        let revenue = 0;
        for (let day = DAYS_OF_HISTORY; day >= 0; day--) {
            // Busier at weekends and busier as the shop grows.
            const weekday = new Date(Date.now() - day * 86400000).getDay();
            const growth = 1 + (DAYS_OF_HISTORY - day) / DAYS_OF_HISTORY;
            let orderCount = rand() < 0.45 * growth ? 1 : 0;
            if ((weekday === 0 || weekday === 6) && rand() < 0.5) orderCount++;
            if (rand() < 0.12 * growth) orderCount++;

            for (let n = 0; n < orderCount; n++) {
                const customer = pick(customers);
                const status = pick(STATUS_MIX);
                const type = rand() < 0.14 ? 'wholesale' : (rand() < 0.08 ? 'preorder' : 'retail');
                const createdAt = isoDaysAgo(day, between(8, 20));

                const lines = [];
                const lineCount = type === 'wholesale' ? between(2, 4) : between(1, 3);
                for (let l = 0; l < lineCount; l++) {
                    const product = rand() < 0.45 ? pick(bestSellers) : pick(products);
                    if (lines.some((x) => x.id === product.id)) continue;
                    const qty = type === 'wholesale' ? between(6, 20) : between(1, 3);
                    lines.push({ id: product.id, name: product.name, qty, price: product.price });
                }
                if (!lines.length) continue;

                const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
                const orderNumber = DEMO_ORDER_PREFIX + String(1000 + made);

                const res = await run(
                    `INSERT INTO orders
                       (order_number, customer_name, customer_phone, customer_email, order_type,
                        total_amount, status, delivery_area, notes, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [orderNumber, customer.name, customer.phone,
                        customer.name.toLowerCase().replace(/\s+/g, '.') + '@example.com',
                        type, Math.round(total * 100) / 100, status, pick(AREAS),
                        'Demonstration order.', createdAt, createdAt]);
                const orderId = res.lastID;

                for (const l of lines) {
                    await run(
                        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price_at_time)
                         VALUES (?, ?, ?, ?, ?)`, [orderId, l.id, l.name, l.qty, l.price]);
                    // Match the server's rule: anything not cancelled is either
                    // holding stock or has consumed it.
                    if (status !== 'cancelled') {
                        await run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', [l.qty, l.id]);
                    }
                }

                if (REVENUE_STATUSES.includes(status)) {
                    revenue += total;
                    await run(
                        `INSERT INTO payments
                           (order_id, payment_method, amount, status, currency, paid_at, created_at)
                         VALUES (?, ?, ?, 'success', 'GHS', ?, ?)`,
                        [orderId, pick(PAYMENT_METHODS), Math.round(total * 100) / 100, createdAt, createdAt]);
                } else if (STOCK_HOLDING_STATUSES.includes(status)) {
                    await run(
                        `INSERT INTO payments
                           (order_id, payment_method, amount, status, currency, created_at)
                         VALUES (?, ?, ?, 'pending', 'GHS', ?)`,
                        [orderId, pick(PAYMENT_METHODS), Math.round(total * 100) / 100, createdAt]);
                }
                made++;
            }
        }
        await run('COMMIT');

        const lowStock = await get('SELECT COUNT(*) AS n FROM products WHERE stock > 0 AND stock <= 5');
        console.log(`seeded ${SUPPLIERS.length} suppliers, ${customers.length} customers, ${made} orders`);
        console.log(`  over ${DAYS_OF_HISTORY} days, GHS ${revenue.toFixed(2)} recognised`);
        console.log(`  ${lowStock.n} products now read as low stock`);
    } catch (err) {
        await run('ROLLBACK');
        throw err;
    }
}

main()
    .then(() => db.close())
    .catch((err) => { console.error('seed failed:', err.message); db.close(); process.exit(1); });
