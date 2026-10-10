# RUNBOOK — DC Kids Brand

What to do when something breaks. Written for whoever is on duty, no context assumed.
Server = Express on port 3001 serving the storefront, admin, and API from one process.

## Start / stop / restart
```
cd server
node server.js                 # start (or: npm start)
```
Stop: Ctrl-C in its terminal, or find the PID: `netstat -ano | findstr :3001` → `taskkill /PID <pid> /F`.
On boot the server prints `Server running on port 3001` only after the DB schema is ready.
Production refuses to start without `JWT_SECRET` and `RESEND_API_KEY` — that's deliberate.

## Health
- `GET /healthz` returns 200 when the process is up.
- `GET /readyz` returns 200 only when SQLite responds and every configured storage directory is writable.
- `GET /api/health` returns generic database/storage state, uptime, and a timestamp without exposing paths, SQL errors, or secrets.

## "The site is down"
1. No `/healthz` response means the process exited. Check Render logs for the last fatal error; its restart policy should start a clean process.
2. `/healthz` succeeds but `/readyz` fails when the database or persistent storage is unavailable. Check that the disk is mounted, `DATA_DIR=/var/data`, and free space remains.
3. Both endpoints succeed but one browser is stale: hard-refresh and allow the new service worker to take control.
## "Sign-in codes not arriving"
1. Server log shows `[email sent] id=…` → Resend accepted it: check spam; free tier only delivers to the Resend account owner's email until the domain is verified.
2. `[email skipped: no RESEND_API_KEY]` → key missing from `server/.env`.
3. `[email failed 4xx]` → key invalid/revoked: mint a new key at resend.com, update `.env`, restart.
4. Locked out entirely → recovery codes (each works once), or in local dev the code prints in the server terminal.

## Backups & restore
- Automatic: the single app instance runs the shared online-backup utility daily. Files land in `${BACKUP_DIR}` or `${DATA_DIR}/backups`, pass `PRAGMA integrity_check`, and the newest 30 successful backups are retained.
- Manual: from `server/`, run `npm run backup`.
- Restore: stop the Render service, select a verified `inventory_*.db`, copy it over `${DB_PATH}` or `${DATA_DIR}/inventory.db`, remove stale `inventory.db-wal` and `inventory.db-shm`, restart, verify `/readyz` and `/api/health`, then spot-check orders in admin.
- Configure Render persistent-disk snapshots separately with daily, weekly, and monthly retention. Local backups are on the same disk and do not replace snapshots.
- Quarterly drill: restore the latest backup to a scratch database and compare representative products, customers, and orders.
## Rollback a bad deploy/commit
```
git log --oneline -10          # find the last good commit
git revert <bad-commit>        # safe, history-preserving
npm test                       # smoke + operational checks must pass
git push origin dev main
```
Then restart the server. Never `reset --hard` on shared branches.

## Common local issues
- **Port 3001 already in use** → another instance is running; kill it (see start/stop). Never run two copies against one DB.
- **"Server unavailable" on the admin login** → the page was opened from the wrong port; use `http://localhost:3001/admin.html`.
- **DB locked** → a second process holds it (often a stray server); kill it and retry.

## Deploy-day env vars (server refuses to boot without the critical ones)
`NODE_ENV=production`, `JWT_SECRET`, `RESEND_API_KEY`, `OWNER_EMAIL`, `ALLOWED_ORIGINS`,
optional: `RESEND_FROM`, `GOOGLE_CLIENT_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_URL`, `PORT`.
