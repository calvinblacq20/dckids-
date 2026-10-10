const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const { buildConfig, ConfigurationError } = require('./config');
const { checkHealth } = require('./health');

const TEST_ROOT = path.join(__dirname, '_operations_test_data');
const DB_PATH = path.join(TEST_ROOT, 'inventory.db');
const UPLOAD_DIR = path.join(TEST_ROOT, 'uploads');
const BACKUP_DIR = path.join(TEST_ROOT, 'backups');
let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.error(`  FAIL  ${name}${detail ? ' - ' + detail : ''}`); }
}

function safeCleanup() {
    const resolved = path.resolve(TEST_ROOT);
    if (path.dirname(resolved) !== path.resolve(__dirname) || path.basename(resolved) !== '_operations_test_data') {
        throw new Error('Refusing to clean an unexpected operations-test directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
}

function openDatabase(file, mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(file, mode, (error) => error ? reject(error) : resolve(database));
    });
}

function runSql(database, sql, params = []) {
    return new Promise((resolve, reject) => database.run(sql, params, (error) => error ? reject(error) : resolve()));
}

function getSql(database, sql, params = []) {
    return new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function closeDatabase(database) {
    return new Promise((resolve) => database.close(() => resolve()));
}

function healthResult(database, directory) {
    return new Promise((resolve) => checkHealth(database, directory, resolve));
}

async function run() {
    safeCleanup();
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const productionEnv = {
        NODE_ENV: 'production',
        PORT: '3001',
        DATA_DIR: TEST_ROOT,
        JWT_SECRET: 'x'.repeat(64),
        ALLOWED_ORIGINS: 'https://dckidsgh.com,https://www.dckidsgh.com',
        APP_URL: 'https://dckidsgh.com',
        OWNER_EMAIL: 'info@dckidsbrand.com',
        RESEND_API_KEY: 're_test_placeholder',
        RESEND_FROM: 'DC Kids <no-reply@updates.dckidsgh.com>'
    };
    const resolved = buildConfig(productionEnv, { createDirectories: false });
    check('production config resolves database under DATA_DIR', resolved.dbPath === DB_PATH, resolved.dbPath);
    check('production config resolves uploads under DATA_DIR', resolved.uploadDir === UPLOAD_DIR, resolved.uploadDir);
    check('production config resolves backups under DATA_DIR', resolved.backupDir === BACKUP_DIR, resolved.backupDir);

    let invalidError = null;
    try {
        buildConfig(Object.assign({}, productionEnv, {
            DATA_DIR: '',
            JWT_SECRET: 'leaked-secret-value',
            ALLOWED_ORIGINS: 'http://insecure.example',
            APP_URL: 'http://insecure.example',
            OWNER_EMAIL: 'not-an-email',
            RESEND_API_KEY: '',
            RESEND_FROM: 'DC Kids Admin <onboarding@resend.dev>',
            PORT: '99999'
        }), { createDirectories: false });
    } catch (error) {
        invalidError = error;
    }
    check('invalid production config fails together', invalidError instanceof ConfigurationError && invalidError.errors.length >= 7);
    check('configuration errors do not echo secret values', invalidError && !invalidError.message.includes('leaked-secret-value'));

    const healthy = await healthResult({ get: (sql, params, callback) => callback(null, { ok: 1 }) }, UPLOAD_DIR);
    check('health checker accepts ready database and storage', healthy.healthy && healthy.database === 'ok' && healthy.storage === 'ok');
    const databaseFailure = await healthResult({ get: (sql, params, callback) => callback(new Error('offline')) }, UPLOAD_DIR);
    check('health checker degrades on database failure', !databaseFailure.healthy && databaseFailure.database === 'unavailable');
    const storageFailure = await healthResult({ get: (sql, params, callback) => callback(null, { ok: 1 }) }, path.join(TEST_ROOT, 'missing'));
    check('health checker degrades on storage failure', !storageFailure.healthy && storageFailure.storage === 'unavailable');
    const partialStorageFailure = await healthResult(
        { get: (sql, params, callback) => callback(null, { ok: 1 }) },
        [UPLOAD_DIR, BACKUP_DIR, path.join(TEST_ROOT, 'missing')]
    );
    check('health checker validates every storage directory', !partialStorageFailure.healthy && partialStorageFailure.storage === 'unavailable');

    const database = await openDatabase(DB_PATH);
    await runSql(database, 'PRAGMA journal_mode = WAL');
    await runSql(database, 'CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    await runSql(database, 'INSERT INTO proof (value) VALUES (?)', ['persistent-value']);
    await closeDatabase(database);

    for (let index = 0; index < 30; index++) {
        const existing = path.join(BACKUP_DIR, `inventory_existing_${String(index).padStart(2, '0')}.db`);
        fs.copyFileSync(DB_PATH, existing);
        const oldTime = new Date(Date.now() - (index + 1) * 60000);
        fs.utimesSync(existing, oldTime, oldTime);
    }

    const backupEnv = Object.assign({}, process.env, {
        NODE_ENV: 'test',
        DATA_DIR: TEST_ROOT,
        DB_PATH,
        UPLOAD_DIR,
        BACKUP_DIR
    });
    const backupRun = spawnSync(process.execPath, ['backup_db.js'], { cwd: __dirname, env: backupEnv, encoding: 'utf8' });
    check('backup command succeeds', backupRun.status === 0, backupRun.stderr);
    const backupFiles = fs.readdirSync(BACKUP_DIR).filter((file) => /^inventory_.*\.db$/.test(file));
    check('backup retention keeps newest 30 files', backupFiles.length === 30, `got ${backupFiles.length}`);
    const newest = backupFiles.map((file) => ({ file, modified: fs.statSync(path.join(BACKUP_DIR, file)).mtimeMs }))
        .sort((a, b) => b.modified - a.modified)[0].file;
    const restored = await openDatabase(path.join(BACKUP_DIR, newest), sqlite3.OPEN_READONLY);
    const integrity = await getSql(restored, 'PRAGMA integrity_check');
    const proof = await getSql(restored, 'SELECT value FROM proof WHERE id = 1');
    await closeDatabase(restored);
    check('backup passes SQLite integrity check', String(Object.values(integrity)[0]).toLowerCase() === 'ok');
    check('backup restores representative data', proof && proof.value === 'persistent-value');

    const beforeFailure = fs.readdirSync(BACKUP_DIR).sort().join('|');
    const failedRun = spawnSync(process.execPath, ['backup_db.js'], {
        cwd: __dirname,
        env: Object.assign({}, backupEnv, { DB_PATH: path.join(TEST_ROOT, 'missing.db') }),
        encoding: 'utf8'
    });
    const afterFailure = fs.readdirSync(BACKUP_DIR).sort().join('|');
    check('missing database makes backup command fail', failedRun.status !== 0);
    check('failed backup leaves successful backups untouched', beforeFailure === afterFailure);
    check('failed backup leaves no temporary files', !fs.readdirSync(BACKUP_DIR).some((file) => file.includes('.tmp-')));

    console.log(`\n${passed} passed, ${failed} failed`);
    safeCleanup();
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('FATAL:', error);
    safeCleanup();
    process.exit(1);
});
