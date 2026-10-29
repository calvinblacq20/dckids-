/* Write products.json from the database.
 *
 * The storefront asks /api/products first and falls back to products.json when
 * there is no API behind it — which is the case on the static Vercel build.
 * So that file is the catalogue every visitor to the showcase actually sees,
 * and it goes stale the moment the database changes. This regenerates it.
 *
 * Field order matches what the file already had, so the diff shows the data
 * that changed rather than a reshuffle of every line.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB = process.env.DB_PATH || path.join(__dirname, 'inventory.db');
const OUT = path.join(__dirname, '..', 'products.json');

const FIELDS = ['id', 'name', 'size', 'price', 'img', 'cat', 'stock', 'badge',
                'updated_at', 'sku', 'description', 'fulfillment_type', 'sizes', 'compare_at_price'];

const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);

db.all(`SELECT ${FIELDS.join(', ')} FROM products ORDER BY id`, (error, rows) => {
    if (error) {
        console.error('FAILED:', error.message);
        process.exit(1);
    }

    // Same rule as GET /api/products/:id: another product's main photo is a
    // borrowed filler, not part of this product's gallery.
    db.all(`SELECT pi.product_id, pi.image_url FROM product_images pi
             WHERE NOT EXISTS (SELECT 1 FROM products other
                                WHERE other.id <> pi.product_id AND other.img = pi.image_url)
             ORDER BY pi.id`, (galleryError, galleryRows) => {
        if (galleryError) {
            console.error('FAILED:', galleryError.message);
            process.exit(1);
        }
        const galleries = {};
        for (const { product_id: id, image_url: url } of galleryRows) {
            if (!url) continue;
            const list = galleries[id] || (galleries[id] = []);
            if (!list.includes(url)) list.push(url);
        }

        // Reassemble each row in the declared order; SQLite returns column order
        // but being explicit keeps the file stable if the schema ever gains a column.
        // Only a real multi-photo gallery is written, so the static build shows it
        // without padding every single-photo product with a one-item list.
        const catalogue = rows.map((row) => {
            const out = {};
            for (const field of FIELDS) out[field] = row[field] === undefined ? null : row[field];
            if ((galleries[row.id] || []).length > 1) out.images = galleries[row.id];
            return out;
        });

        const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
        fs.writeFileSync(OUT, JSON.stringify(catalogue, null, 2) + '\n', 'utf8');

        console.log(`products.json: ${previous.length} -> ${catalogue.length}`);
        const added = catalogue.length - previous.length;
        if (added > 0) console.log(`${added} more than before`);
        db.close();
    });
});
