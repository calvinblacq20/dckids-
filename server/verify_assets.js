const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

console.log('Auditing project image assets...\n');

db.all(`SELECT id, name, img FROM products`, [], (err, rows) => {
    if (err) {
        console.error('Database query failed:', err.message);
        process.exit(1);
    }

    let total = rows.length;
    let verified = 0;
    let missing = 0;
    const missingItems = [];

    rows.forEach(p => {
        if (!p.img) {
            missing++;
            missingItems.push({ id: p.id, name: p.name, reason: 'No image path set' });
            return;
        }

        const fullPath = path.resolve(__dirname, '..', p.img);
        if (fs.existsSync(fullPath)) {
            verified++;
        } else {
            missing++;
            missingItems.push({ id: p.id, name: p.name, path: p.img, reason: 'File does not exist' });
        }
    });

    console.log('--------------------------------------------------');
    console.log(`TOTAL PRODUCTS IN DB:  ${total}`);
    console.log(`VERIFIED EXIST:        ${verified}`);
    console.log(`MISSING/UNRESOLVED:    ${missing}`);
    console.log('--------------------------------------------------\n');

    if (missingItems.length > 0) {
        console.log('--- MISSING IMAGES LOG ---');
        missingItems.forEach(item => {
            if (item.path) {
                console.log(`[Product #${item.id}] ${item.name} -> Path: "${item.path}" (${item.reason})`);
            } else {
                console.log(`[Product #${item.id}] ${item.name} -> ${item.reason}`);
            }
        });
        console.log('\nRecommendation: Generate or copy placeholder images to match these paths.');
    } else {
        console.log('SUCCESS: All database products have valid, physical image files! 🎉');
    }

    db.close();
});
