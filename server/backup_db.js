/* WAL-safe SQLite backup utility shared by the CLI and runtime scheduler. */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const config = require('./config');

const RETENTION_COUNT = 30;

function openDatabase(file, mode) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(file, mode, (error) => error ? reject(error) : resolve(database));
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
        const finish = (error) => backup.finish((finishError) => error || finishError ? reject(error || finishError) : resolve());
        const step = (error) => {
            if (error) return finish(error);
            if (backup.remaining > 0) return backup.step(-1, step);
            finish();
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
        if (String(result && Object.values(result)[0] || '').toLowerCase() !== 'ok') {
            throw new Error('SQLite integrity check failed');
        }
    } finally {
        await closeDatabase(database);
    }
}

function cleanupTemporaryArtifacts(file) {
    ['', '-journal', '-wal', '-shm'].forEach((suffix) => {
        try { fs.rmSync(file + suffix, { force: true }); } catch { /* best effort */ }
    });
}

function pruneSuccessfulBackups(backupDir, retentionCount = RETENTION_COUNT) {
    const files = fs.readdirSync(backupDir)
        .filter((file) => /^inventory_.*\.db$/.test(file))
        .map((file) => ({ file, modified: fs.statSync(path.join(backupDir, file)).mtimeMs }))
        .sort((a, b) => b.modified - a.modified);
    files.slice(retentionCount).forEach(({ file }) => fs.unlinkSync(path.join(backupDir, file)));
}

async function runBackup(options = {}) {
    const dbPath = options.dbPath || config.dbPath;
    const backupDir = options.backupDir || config.backupDir;
    const retentionCount = Number.isInteger(options.retentionCount) ? options.retentionCount : RETENTION_COUNT;
    if (!fs.existsSync(dbPath)) throw new Error('Database file not found');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = (options.now || new Date()).toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `inventory_${timestamp}.db`);
    const temporaryFile = `${backupFile}.tmp-${process.pid}`;
    cleanupTemporaryArtifacts(temporaryFile);

    let source;
    try {
        source = await openDatabase(dbPath, sqlite3.OPEN_READONLY);
        await copyDatabase(source, temporaryFile);
        await closeDatabase(source);
        source = null;
        await verifyDatabase(temporaryFile);
        fs.renameSync(temporaryFile, backupFile);
        cleanupTemporaryArtifacts(temporaryFile);
        pruneSuccessfulBackups(backupDir, retentionCount);
        return backupFile;
    } catch (error) {
        await closeDatabase(source);
        cleanupTemporaryArtifacts(temporaryFile);
        throw error;
    }
}

if (require.main === module) {
    runBackup().then((backupFile) => {
        const sizeKb = (fs.statSync(backupFile).size / 1024).toFixed(0);
        console.log(`Backed up database to ${backupFile} (${sizeKb} KB, integrity check passed)`);
    }).catch((error) => {
        console.error('Database backup failed:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { runBackup, verifyDatabase, pruneSuccessfulBackups, RETENTION_COUNT };