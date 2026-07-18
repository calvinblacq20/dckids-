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
- `GET /healthz` → 200 = process up.  `GET /readyz` → 200 = DB reachable.
- Telegram alerts fire on crashes and 500s (same bot as order alerts).

## "The site is down"
1. `curl -s localhost:3001/healthz` — no answer → process died: check the terminal/host logs for the last `[server error]` or `[uncaughtException]`, then restart.
2. `/healthz` OK but `/readyz` fails → database problem: check disk space and that `server/inventory.db` exists; restore from backup if corrupted (below).
3. Both OK but the page is stale/broken in one browser → cache: hard-refresh; the service worker updates on the next load after a version bump.

## "Sign-in codes not arriving"
1. Server log shows `[email sent] id=…` → Resend accepted it: check spam; free tier only delivers to the Resend account owner's email until the domain is verified.
2. `[email skipped: no RESEND_API_KEY]` → key missing from `server/.env`.
3. `[email failed 4xx]` → key invalid/revoked: mint a new key at resend.com, update `.env`, restart.
4. Locked out entirely → recovery codes (each works once), or in local dev the code prints in the server terminal.

## Backups & restore
- Automatic: daily in-process backup to `server/backups/` (WAL-safe, keeps newest 30, Telegram-alerts on failure).
- Manual: `node server/backup_db.js`.
- **Restore:** stop the server → copy the chosen `server/backups/inventory_*.db` over `server/inventory.db` (delete stale `inventory.db-wal`/`-shm`) → start → verify `/readyz` and spot-check orders in the admin.
- Quarterly drill: restore the latest backup to a scratch file and open it — a backup you've never restored is a hope, not a plan.

## Rollback a bad deploy/commit
```
git log --oneline -10          # find the last good commit
git revert <bad-commit>        # safe, history-preserving
npm test                       # 47 checks must pass
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
