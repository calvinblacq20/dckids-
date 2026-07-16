/* DC Kids database backup.
 *
 * Uses SQLite's online backup API so WAL contents are included in one
 * transactionally consistent file. Paths come from the shared configuration:
 * DB_PATH overrides DATA_DIR/inventory.db and BACKUP_DIR overrides
 * DATA_DIR/backups.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const config = require('./config');

const RETENTION_COUNT = 30;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(config.backupDir, `inventory_${timestamp}.db`);
const temporaryFile = backupFile + `.tmp-${process.pid}`;

function cleanupTemporaryArtifacts() {
    ['', '-journal', '-wal', '-shm'].forEach((suffix) => {
        try { fs.rmSync(temporaryFile + suffix, { force: true }); } catch (error) { /* best effort */ }
    });
}

function openDatabase(file, mode) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(file, mode, (error) => {
            if (error) reject(error);
            else resolve(database);
        });
    });
}

function closeDatabase(database) {
    return new Promise((resolve) => {
        if (!database) return resolve();
        database.close(() => resolve());
    });
}

function copyDatabase(source, destination) {
    return new Promise((resolve, reject) => {
        const backup = source.backup(destination);
        const finishWith = (error) => {
            backup.finish((finishError) => {
                if (error || finishError) reject(error || finishError);
                else resolve();
            });
        };
        const step = (error) => {
            if (error) return finishWith(error);
            if (backup.remaining > 0) return backup.step(-1, step);
            finishWith();
        };
        backup.step(-1, step);
    });
}

async function verifyDatabase(file) {
    const database = await openDatabase(file, sqlite3.OPEN_READONLY);
    try {
        const result = await new Promise((resolve, reject) => {
            database.get('PRAGMA integrity_check', [], (error, row) => error ? reject(error) : resolve(row));
        });
        const value = result && Object.values(result)[0];
        if (String(value || '').toLowerCase() !== 'ok') throw new Error('SQLite integrity check failed');
    } finally {
        await closeDatabase(database);
    }
}

function pruneSuccessfulBackups() {
    const files = fs.readdirSync(config.backupDir)
        .filter((file) => /^inventory_.*\.db$/.test(file))
        .map((file) => ({ file, modified: fs.statSync(path.join(config.backupDir, file)).mtimeMs }))
        .sort((a, b) => b.modified - a.modified);
    files.slice(RETENTION_COUNT).forEach(({ file }) => fs.unlinkSync(path.join(config.backupDir, file)));
}

async function main() {
    if (!fs.existsSync(config.dbPath)) throw new Error('Database file not found');
    fs.mkdirSync(config.backupDir, { recursive: true });
    cleanupTemporaryArtifacts();

    const source = await openDatabase(config.dbPath, sqlite3.OPEN_READONLY);
    try {
        await copyDatabase(source, temporaryFile);
    } finally {
        await closeDatabase(source);
    }

    await verifyDatabase(temporaryFile);
    fs.renameSync(temporaryFile, backupFile);
    cleanupTemporaryArtifacts();
    pruneSuccessfulBackups();

    const sizeKb = (fs.statSync(backupFile).size / 1024).toFixed(0);
    console.log(`Backed up database to ${backupFile} (${sizeKb} KB, integrity check passed)`);
}

main().catch((error) => {
    cleanupTemporaryArtifacts();
    console.error('Database backup failed:', error.message);
    process.exitCode = 1;
});
