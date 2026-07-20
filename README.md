# DC Kids Brand

A complete e-commerce storefront **and** admin panel for DC Kids Brand — a children's
clothing, footwear, bedding, and accessories shop. Customers browse and order on the
storefront; the owner manages everything from the admin panel. The checkout flow is
WhatsApp-native (orders are recorded server-side, then confirmed over WhatsApp / mobile
money), which fits a manual-fulfilment SME.

Built deliberately with **vanilla HTML/CSS/JS** on the front end (no framework) and a
small **Node + Express + SQLite** backend, for lightweight load times and easy hosting.

---

## Architecture

One Express process serves **both** the static front end and the JSON API, so there's a
single thing to deploy and no CORS issues in normal use.

```
web prototype 1/
├── index.html          Storefront (catalogue, cart, checkout, tracking)
├── app.js              Storefront logic
├── styles.css          Storefront styles
├── track.html          Order tracking page
├── admin.html          Admin panel (single-page)
├── admin.js            Admin logic
├── admin.css           Admin styles
├── manifest.json       Storefront PWA manifest
├── admin.manifest.json Admin PWA manifest
├── service-worker.js   PWA service worker (offline shell + caching)
├── gradient.js         Decorative background
├── images/             Product & promo images (optimized, ≤1000px)
└── server/
    ├── server.js       Express API + static file server
    ├── db.js           SQLite schema, migrations, seed data
    ├── config.js       Central validated runtime/storage configuration
    ├── health.js       Database and writable-storage checks
    ├── backup_db.js    Shared online SQLite backup utility
    ├── test_operations.js  Storage/config/backup tests
    ├── test_smoke.js       End-to-end API smoke tests
    ├── verify_assets.js     Asset sanity check
    ├── inventory.db    SQLite database (gitignored — holds real data)
    └── .env            Secrets & config (gitignored)
```

The front end talks to the backend via the relative path `/api`, so it works on any host
or domain without configuration.

---

## Features

### Storefront
- Product catalogue with categories, search, and pagination
- **Retail and wholesale** modes (wholesale applies MOQ + discount math)
- **Per-product sizes with their own prices** (admin-managed; authoritative on the server)
- **China pre-orders** as a per-product listing type (independent of category)
- Cart, checkout (records the order, then hands off to WhatsApp), order tracking
- Product reviews, wishlist, optional customer accounts
- Installable **PWA** (add to home screen, offline app shell)

### Admin panel
- Product management: full CRUD, auto-generated SKUs (editable), per-size pricing,
  global size presets, image upload, bulk CSV import
- Owner-managed **categories** (add / rename / delete, reflected on the storefront)
- Inventory, orders, customers, suppliers, analytics, reports
- New-order notifications in the bell (live poll) + optional **Telegram** alerts
- Settings: store config, WhatsApp number, wholesale rules, banner, password change

---

## Getting started (local)

Requires Node.js (18+ recommended).

```bash
cd server
npm install
node server.js
```

The server prints the port it is listening on (default **3001**). Then open:

- Storefront: <http://localhost:3001/>
- Admin: <http://localhost:3001/admin.html>

Admin sign-in is passwordless. On a fresh database, addresses listed in `OWNER_EMAIL` become owners; other sign-ups wait for approval. Email codes use Resend and one-time recovery codes provide backup access.

---

## Configuration

Set these in `server/.env`; production values belong in the Render dashboard:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Set to `production` for strict validation, CORS, HSTS, and rate limits. |
| `DATA_DIR` | Persistent root (`/var/data` on Render); defaults DB, uploads, and backups beneath it. |
| `DB_PATH` / `UPLOAD_DIR` / `BACKUP_DIR` | Optional storage-path overrides. |
| `JWT_SECRET` | Unique session-signing secret of at least 32 characters. |
| `ALLOWED_ORIGINS` / `APP_URL` | HTTPS public origins; `APP_URL` must be allowed. |
| `OWNER_EMAIL` | Comma-separated owner email allowlist. |
| `RESEND_API_KEY` / `RESEND_FROM` | Required production email credentials and verified sender. |
| `PORT` | Listening port (default 3001; Render injects it). |
| `GOOGLE_CLIENT_ID` | Optional Google admin sign-in. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional order and error alerts. |

---
## Scripts

From `server/`:

```bash
npm start             # app/API/static server
npm test              # operational + smoke tests
npm run lint          # ESLint
npm run build          # storefront and admin Tailwind CSS
npm run backup         # integrity-checked online SQLite backup
```

---
## Data, images & backups

- SQLite is the production source of truth; `products.json` seeds only a fresh database.
- Local development defaults to `server/inventory.db`, `server/uploads/`, and `server/backups/`. Render uses one persistent disk with `DATA_DIR=/var/data`.
- New uploads are stored as `images/uploads/product_upload_*`; legacy `images/product_upload_*` records remain compatible.
- Run
pm run backup` from `server/` for an integrity-checked online backup. Stop the service before restoring and remove stale `-wal`/`-shm` sidecars.
- Keep one app instance with SQLite and configure Render disk snapshots separately.

---
## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full checklist. Render serves the app over HTTPS with one instance and `DATA_DIR=/var/data`. Production also requires a strong `JWT_SECRET`, HTTPS `ALLOWED_ORIGINS`/`APP_URL`, `OWNER_EMAIL`, and verified Resend credentials.

---
## Tech notes

- **Security:** bcrypt password hashing, JWT auth with role-gated routes, parameterized
  SQL throughout, server-side order pricing (never trusts client-sent prices),
  manual security headers, in-memory rate limiting, MIME-validated image uploads.
- **PWA:** separate storefront/admin manifests + a service worker (network-first for
  HTML/JS/CSS, cache-first for images/fonts).
- **Images:** product/promo images are downscaled to ≤1000px and recompressed; pre-edit
  originals are kept in the gitignored `_image_originals_backup/`.
