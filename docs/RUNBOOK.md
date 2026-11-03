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
Production refuses to start without a strong `JWT_SECRET` — that's deliberate. A missing
`GOOGLE_CLIENT_ID` or `RESEND_API_KEY` is a boot warning instead, so the shop keeps selling.

## Health
- `GET /healthz` returns 200 when the process is up.
- `GET /readyz` returns 200 only when SQLite responds and every configured storage directory is writable.
- `GET /api/health` returns generic database/storage state, uptime, and a timestamp without exposing paths, SQL errors, or secrets.

## "The site is down"
1. No `/healthz` response means the process exited. Check Render logs for the last fatal error; its restart policy should start a clean process.
2. `/healthz` succeeds but `/readyz` fails when the database or persistent storage is unavailable. Check that the disk is mounted, `DATA_DIR=/var/data`, and free space remains.
3. Both endpoints succeed but one browser is stale: hard-refresh and allow the new service worker to take control.
## "Can't sign in to the admin"
1. The page says "Sign-in isn't set up yet" → `GOOGLE_CLIENT_ID` is missing on the server (the boot log warns). Set it and restart.
2. Google's button shows an error, or its popup says the origin isn't allowed → add the exact address the admin is opened on (scheme, host and port) to the OAuth client's Authorized JavaScript origins in Google Cloud Console.
3. Only some people can sign in → the OAuth consent screen is still in Testing: add them as test users, or publish the app.
4. "Access requested" or "awaiting the owner's approval" → the account is pending; the owner approves it under Manage Staff → Access Requests.
5. The owner is locked out of her Google account → recover it through Google. If that's impossible, set `OWNER_EMAIL` to her new address on the host and restart; it becomes the owner on its first sign-in.

## "Notification emails not arriving" (access requests, new-staff notes)
1. No `[email failed …]` or `[email skipped …]` line in the log → Resend accepted it: check spam; until the domain is verified, Resend only delivers to its account owner's email.
2. `[email skipped: no RESEND_API_KEY]` → key missing from `server/.env`.
3. `[email failed 4xx]` → key invalid/revoked: mint a new key at resend.com, update `.env`, restart.

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

## Deploy-day env vars
`NODE_ENV=production`, `JWT_SECRET` (the server refuses to boot without it), `GOOGLE_CLIENT_ID` (the admin's only sign-in), `OWNER_EMAIL`, `ALLOWED_ORIGINS`,
optional: `RESEND_API_KEY`, `RESEND_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APP_URL`, `PORT`.
