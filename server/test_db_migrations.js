// Boots the real schema migrations against a database created before
// payments.updated_at and customers.updated_at existed. SQLite cannot ADD COLUMN
// with a CURRENT_TIMESTAMP default, so these columns used to be skipped on long-
// lived databases and every later write to them failed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dckids-migration-test-'));
const dbPath = path.join(tempRoot, 'inventory.db');
let passed = 0;

// The schema these three tables had in the first production release.
const LEGACY_SCHEMA = `
    CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        customer_name TEXT,
        customer_phone TEXT,
        order_type TEXT,
        total_amount REAL,
        status TEXT,
        delivery_area TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Mobile Money',
        amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (id)
    );
    INSERT INTO customers (name, phone) VALUES ('Legacy Customer', '+233200000001');
    INSERT INTO orders (order_number, customer_name, customer_phone, order_type, total_amount, status)
        VALUES ('DCK-LEGACY-1', 'Order Customer', '+233200000002', 'retail', 120, 'pending');
    INSERT INTO payments (order_id, amount) VALUES (1, 120);
`;

// Runs in a child so each boot gets a fresh module cache and its own connection.
const BOOT_SCRIPT = 'const db = require(process.argv[1]); db.whenReady(() => db.close((err) => process.exit(err ? 1 : 0)));';

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        console.error(`  FAIL  ${name} — ${error.message}`);
        throw error;
    }
}

function open() {
    return new Promise((resolve, reject) => {
        const sqlite = new sqlite3.Database(dbPath, (error) => error ? reject(error) : resolve(sqlite));
    });
}

function exec(sqlite, sql) {
    return new Promise((resolve, reject) => sqlite.exec(sql, (error) => error ? reject(error) : resolve()));
}

function run(sqlite, sql, params = []) {
    return new Promise((resolve, reject) => sqlite.run(sql, params, (error) => error ? reject(error) : resolve()));
}

function get(sqlite, sql, params = []) {
    return new Promise((resolve, reject) => sqlite.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function all(sqlite, sql) {
    return new Promise((resolve, reject) => sqlite.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
}

function close(sqlite) {
    return new Promise((resolve, reject) => sqlite.close((error) => error ? reject(error) : resolve()));
}

function bootSchema() {
    return spawnSync(process.execPath, ['-e', BOOT_SCRIPT, path.join(__dirname, 'db.js')], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
            NODE_ENV: 'test',
            RAILWAY_ENVIRONMENT: '',
            RAILWAY_PROJECT_ID: '',
            RAILWAY_SERVICE_ID: '',
            RAILWAY_VOLUME_MOUNT_PATH: '',
            DB_PATH: dbPath,
            UPLOAD_DIR: path.join(tempRoot, 'uploads'),
            BACKUP_DIR: path.join(tempRoot, 'backups')
        })
    });
}

async function columnNames(sqlite, table) {
    return (await all(sqlite, `PRAGMA table_info(${table})`)).map((column) => column.name);
}

async function runTests() {
    let sqlite;
    try {
        sqlite = await open();
        await exec(sqlite, LEGACY_SCHEMA);
        await close(sqlite);
        sqlite = null;

        const firstBoot = bootSchema();
        check('legacy database boots', () => {
            assert.strictEqual(firstBoot.status, 0, firstBoot.stderr);
        });
        check('legacy database migrates without logging a failure', () => {
            assert.doesNotMatch(firstBoot.stderr, /failed/i);
        });

        sqlite = await open();
        const paymentColumns = await columnNames(sqlite, 'payments');
        const customerColumns = await columnNames(sqlite, 'customers');
        check('payments.updated_at is added to a legacy database', () => {
            assert.ok(paymentColumns.includes('updated_at'), paymentColumns.join(', '));
        });
        check('customers.updated_at is added to a legacy database', () => {
            assert.ok(customerColumns.includes('updated_at'), customerColumns.join(', '));
        });

        const legacyPayment = await get(sqlite, 'SELECT updated_at FROM payments WHERE id = 1');
        const legacyCustomer = await get(sqlite, "SELECT updated_at FROM customers WHERE phone = '+233200000001'");
        check('existing payment rows are backfilled with a timestamp', () => {
            assert.ok(legacyPayment.updated_at, 'payments.updated_at is still NULL');
        });
        check('existing customer rows are backfilled with a timestamp', () => {
            assert.ok(legacyCustomer.updated_at, 'customers.updated_at is still NULL');
        });

        const orderCustomer = await get(sqlite, "SELECT name FROM customers WHERE phone = '+233200000002'");
        check('customers are backfilled from legacy order history', () => {
            assert.strictEqual(orderCustomer && orderCustomer.name, 'Order Customer');
        });

        // The statement the Paystack verification path runs once a charge succeeds.
        await run(sqlite, `UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP WHERE id = 1`);
        const paidPayment = await get(sqlite, 'SELECT status FROM payments WHERE id = 1');
        check('Paystack payment update succeeds on a migrated legacy database', () => {
            assert.strictEqual(paidPayment.status, 'paid');
        });

        // Checkout inserts payments without updated_at, which stays NULL here
        // because the migrated column has no default.
        await run(sqlite, `INSERT INTO payments (order_id, payment_method, amount, status) VALUES (1, 'WhatsApp', 50, 'pending')`);
        await close(sqlite);
        sqlite = null;

        const secondBoot = bootSchema();
        check('second boot re-adds no columns', () => {
            assert.strictEqual(secondBoot.status, 0, secondBoot.stderr);
            assert.doesNotMatch(secondBoot.stdout, /Migration: added/);
        });
        check('second boot logs no migration failure', () => {
            assert.doesNotMatch(secondBoot.stderr, /failed/i);
        });

        sqlite = await open();
        const nullTimestamps = await get(sqlite, 'SELECT COUNT(*) AS count FROM payments WHERE updated_at IS NULL');
        check('boot backfills payments inserted without updated_at', () => {
            assert.strictEqual(nullTimestamps.count, 0);
        });
        await close(sqlite);
        sqlite = null;

        console.log(`\n${passed} passed, 0 failed`);
    } finally {
        if (sqlite) {
            try { await close(sqlite); } catch (error) { /* test cleanup only */ }
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

runTests().catch((error) => {
    console.error('FATAL:', error);
    process.exit(1);
});
