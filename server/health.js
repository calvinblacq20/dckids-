const fs = require('fs');

function checkStorageDirectories(directories, callback) {
    const pending = (Array.isArray(directories) ? directories : [directories]).filter(Boolean);
    if (!pending.length) return callback(new Error('No storage directories configured'));
    let remaining = pending.length;
    let firstError = null;
    pending.forEach((directory) => {
        fs.access(directory, fs.constants.R_OK | fs.constants.W_OK, (error) => {
            if (error && !firstError) firstError = error;
            remaining--;
            if (!remaining) callback(firstError);
        });
    });
}

function checkHealth(db, storageDirectories, callback) {
    checkStorageDirectories(storageDirectories, (storageError) => {
        db.get('SELECT 1 AS ok', [], (databaseError, row) => {
            const databaseOk = !databaseError && row && Number(row.ok) === 1;
            const storageOk = !storageError;
            callback({
                healthy: databaseOk && storageOk,
                database: databaseOk ? 'ok' : 'unavailable',
                storage: storageOk ? 'ok' : 'unavailable'
            });
        });
    });
}

module.exports = { checkHealth };
