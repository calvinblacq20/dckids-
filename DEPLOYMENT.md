# DC Kids Brand — Deployment Guide

The app is a single Node/Express process that serves both the static frontend
(project root) and the JSON API under `/api`. The frontend talks to the backend
via the relative path `/api`, so no host/URL configuration is needed — it works
on whatever domain you deploy to.

## 1. Install & run

```bash
cd server
npm install
node server.js
```

The server listens on `PORT` (default 3000) and serves the whole site.

## 2. Required environment (set on your host, in `server/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | **yes (production)** | Set to `production` to enable strict CORS, HSTS, and tight rate limiting. Unset = dev mode (open CORS, no HSTS). |
| `JWT_SECRET` | **yes** | Secret for signing admin/customer sessions. Use a long random string (32+ chars). Never commit it. |
| `ALLOWED_ORIGINS` | production | Comma-separated origins permitted by CORS, e.g. `https://dckidsbrand.com,https://www.dckidsbrand.com`. |
| `ADMIN_PASSWORD` | recommended | Password for the seeded `admin` account on **first boot only**. If unset, a strong random password is generated and printed once to the server log — capture it. |
| `PORT` | no | Listening port (default 3000). Most hosts inject this automatically. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | no | Optional order-alert notifications. |
| `SHOP_NOTIFY_EMAIL`, `SMTP_*` | no | Optional transactional email. |

## 3. First-boot admin account

On a fresh database the server creates a single manager account:

- **Username:** `admin`
- **Password:** value of `ADMIN_PASSWORD`, or a random one printed once in the
  server log if that variable is unset.

Log in and change it immediately (Admin → Settings → Change Password), or set
`ADMIN_PASSWORD` before first boot. The old hardcoded `admin123` is no longer used.

## 4. Data & backups

- SQLite database lives at `server/inventory.db` (plus `-wal`/`-shm` sidecars).
- It is **gitignored** — it holds customer/order data and must not be committed.
- Persist this file across deploys (mount a volume / persistent disk). If it is
  wiped, the catalogue re-seeds and a new admin account is created.
- `node server/backup_db.js` writes a backup copy.

## 5. Production checklist

- [ ] `NODE_ENV=production` set on the host
- [ ] `JWT_SECRET` is a fresh long random value
- [ ] `ALLOWED_ORIGINS` lists your real domain(s)
- [ ] `ADMIN_PASSWORD` set, or first-boot generated password captured and changed
- [ ] `server/inventory.db` on persistent storage
- [ ] Served over HTTPS (required for the PWA service worker and HSTS)
