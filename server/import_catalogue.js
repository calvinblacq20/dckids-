/* Bring the catalogue from the stock system into the shop database.
 *
 * Upsert, never replace: the screenshots covered J to Y alphabetically, so a
 * wholesale swap would delete every product from A to I. Matching is on a
 * normalised name, since the two systems capitalise differently.
 *
 * Quantities are not in the screenshots — only in-stock or nil. So a match
 * that is still in stock keeps the number the shop already holds rather than
 * having a guess written over it, and only "nil" is taken as fact (zero).
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..');
const DB = process.env.DB_PATH || path.join(__dirname, 'inventory.db');
const catalogue = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const APPLY = process.argv.includes('--apply');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PREFIX = { clothing: 'CLO', shoes: 'SHO', feeding: 'FED', gear: 'GER',
                 bathcare: 'BAT', newborn: 'NBN', bedding: 'BED',
                 accessories: 'ACC', essentials: 'ESS' };

const db = new sqlite3.Database(DB, APPLY ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));

(async () => {
    const existing = await all('SELECT id, name, sku, price, cat, stock FROM products');
    const byName = new Map(existing.map((p) => [norm(p.name), p]));

    // Next free number per prefix, so a new SKU never collides with an old one.
    const nextNum = {};
    for (const p of existing) {
        const m = /^([A-Z]+)-(\d+)$/.exec(p.sku || '');
        if (m) nextNum[m[1]] = Math.max(nextNum[m[1]] || 0, Number(m[2]));
    }

    const updates = [], inserts = [], unchanged = [];
    for (const item of catalogue) {
        const hit = byName.get(norm(item.name));
        if (hit) {
            // Only write a stock number when the stock system says nil. In
            // stock means "some", and the shop's own count is the better guess.
            const stock = item.in_stock ? hit.stock : 0;
            const changed = Number(hit.price) !== item.price || hit.cat !== item.cat || Number(hit.stock) !== stock;
            (changed ? updates : unchanged).push({ ...item, id: hit.id, was: hit, stock });
        } else {
            const prefix = PREFIX[item.cat] || 'GEN';
            nextNum[prefix] = (nextNum[prefix] || 0) + 1;
            inserts.push({ ...item,
                sku: `${prefix}-${String(nextNum[prefix]).padStart(4, '0')}`,
                stock: item.in_stock ? 1 : 0,
                img: `images/category-fallbacks/${item.cat}.webp` });
        }
    }

    console.log(`matched and changed : ${updates.length}`);
    console.log(`matched, no change  : ${unchanged.length}`);
    console.log(`new                 : ${inserts.length}`);
    console.log(`left untouched      : ${existing.length - updates.length - unchanged.length}`);

    if (updates.length) {
        console.log('\n-- price or stock changes --');
        for (const u of updates.slice(0, 40)) {
            const bits = [];
            if (Number(u.was.price) !== u.price) bits.push(`price ${u.was.price} -> ${u.price}`);
            if (Number(u.was.stock) !== u.stock) bits.push(`stock ${u.was.stock} -> ${u.stock}`);
            if (u.was.cat !== u.cat) bits.push(`cat ${u.was.cat} -> ${u.cat}`);
            console.log(`  ${u.was.name}: ${bits.join(', ')}`);
        }
    }
    if (inserts.length) {
        console.log('\n-- new products --');
        for (const i of inserts) console.log(`  ${i.sku}  ${i.name}  GHS ${i.price}  [${i.cat}]${i.in_stock ? '' : '  (nil)'}`);
    }

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply.');
        db.close();
        return;
    }

    for (const u of updates) {
        await run('UPDATE products SET price = ?, cat = ?, stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                  [u.price, u.cat, u.stock, u.id]);
    }
    for (const i of inserts) {
        await run('INSERT INTO products (name, sku, price, cat, stock, img, fulfillment_type, updated_at) ' +
                  'VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                  [i.name, i.sku, i.price, i.cat, i.stock, i.img, 'in_stock']);
    }
    const after = await all('SELECT COUNT(*) n FROM products');
    console.log(`\nAPPLIED. products now: ${after[0].n}`);
    db.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
