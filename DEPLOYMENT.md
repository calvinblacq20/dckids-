# DC Kids Brand — Deployment Guide

The app is a single Node 22.13+ / Express process that serves both the static frontend
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

### Keep it running (important)

The storefront has **no products to show if the Node server isn't running** — the
catalogue comes from the API, and the static `products.json` fallback is served by the
same process, so if it stops, the store goes blank. Two safeguards are in place and one
is up to your host:

- The server now has **crash guards** (`uncaughtException` / `unhandledRejection`): a
  single bad request or stray error is logged but **won't take the whole server down**.
- **Run it under a process manager so it auto-restarts** if it ever exits or the box
  reboots. Examples:
  ```bash
  # PM2
  npm install -g pm2
  pm2 start server.js --name dckids
  pm2 startup && pm2 save        # restart on reboot
  ```
  Or a `systemd` unit with `Restart=always`, or your platform's built-in restart policy
  (Render/Railway/Fly all auto-restart a crashed process). Don't run it as a bare
  `node server.js` in a terminal in production — close the terminal and the store dies.

## 2. Required environment (set on your host, in `server/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | **yes (production)** | Set to `production` to enable strict CORS, HSTS, and tight rate limiting. Unset = dev mode (open CORS, no HSTS). |
| `JWT_SECRET` | **yes** | Secret for signing admin/customer sessions. Use a long random string (32+ chars). Never commit it. |
| `ALLOWED_ORIGINS` | production | Comma-separated origins permitted by CORS, e.g. `https://dckidsbrand.com,https://www.dckidsbrand.com`. The shop's own pages are always allowed on whatever hostname serves them (same-origin), so this list is for other sites that call the API; it must still name the main domain, which `APP_URL` must match. Any other site gets a 403. |
| `OWNER_EMAIL` | **yes (production)** | The owner's email, made owner (manager) on its first Google sign-in. Set it to her address alone: every listed address is an owner (ADR 0007). Everyone else lands in `pending` and must be approved. Unset = the first person to sign in becomes owner. See §3. |
| `GOOGLE_CLIENT_ID` | **yes** | The admin's only sign-in ("Continue with Google"). Unset = nobody can sign in to the admin, while the storefront keeps selling. Setup in §8. |
| `RESEND_API_KEY` / `RESEND_FROM` | optional | Notification emails via Resend. The owner (`OWNER_EMAIL`) gets every new order, new access requests, and a 7am (Ghana time) summary of orders waiting on payment and pieces running low, skipped on days with nothing to report; customers who give an email at checkout get an order confirmation (items, total and a tracking link, without their phone or address); staff the owner adds get a note. Until the shop's domain is verified in Resend and `RESEND_FROM` uses it, Resend delivers only to the Resend account's own address. Unset = those emails are skipped (and logged); sign-in and checkout are unaffected. |
| `APP_URL` | recommended | Public base URL used in emails (e.g. `https://dckidsbrand.com`). |
| `PORT` | no | Listening port (default 3000). Most hosts inject this automatically. |
| `RAILWAY_VOLUME_MOUNT_PATH` | Railway production | Railway injects `/data` when the Volume is mounted there. Never create or edit this variable manually. The app refuses Railway production without it. |
| `RAILWAY_VOLUME_NAME` | Railway production | Railway injects the attached Volume name. Never create or edit this variable manually. The app refuses Railway production without it. |
| `DB_PATH` | Railway production | `/data/inventory.db` (optional only because it is the default when the volume is configured). |
| `UPLOAD_DIR` | Railway production | `/data/uploads` (optional only because it is the default when the volume is configured). |
| `BACKUP_DIR` | Railway production | `/data/backups` (optional only because it is the default when the volume is configured). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | no | Order alerts as phone/desktop notifications from the installed admin app. Generate the pair once with `npx web-push generate-vapid-keys` (from `server/`) and keep it: a new pair silently ends every existing device's alerts. `VAPID_SUBJECT` is a contact, e.g. `mailto:info@dckidsbrand.com`. Each device then turns alerts on in admin **Settings → Order alerts on this device**; on iPhone the admin must first be added to the Home Screen (iOS 16.4+). |
| `SMTP_*` | no | Optional transactional email. |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` | **yes** | Public Firebase web-app configuration used by the customer account page. |
| `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_SERVICE_ACCOUNT_JSON` | production* | Use an external service-account file path, workload identity, or a sealed JSON environment value on Railway-style hosts. Never expose or commit the JSON. |

## 3. First admin account (Google sign-in)

There is **no seeded admin and no password**. The admin's only sign-in is
**Continue with Google**, so set that up first (§8). The owner is claimed like this:

- Set **`OWNER_EMAIL`** to the owner's address alone (ADR 0007). The first time
  that address signs in with Google it becomes the **owner (manager)**;
  **everyone else lands in `pending`** and must be approved from
  **Manage Staff → Access Requests**.
- If `OWNER_EMAIL` is unset, the **first person to sign in becomes owner** — fine
  for local dev, but set `OWNER_EMAIL` before exposing the admin publicly so a
  stranger can't claim it first.
- Only the owner approves requests, and everyone approved or added joins as
  **staff**. Staff the owner adds under Manage Staff can sign in straight away
  with the Google account for their email.
- There are no backup codes. If the owner loses her Google account, recover it
  through Google, or set `OWNER_EMAIL` to her new address on the host and restart.

## 4. Firebase customer authentication

Customer accounts use Firebase Authentication; the admin's Google sign-in (§8) is a separate system.

1. Create a Firebase project and register a **Web app** for DC Kids.
2. In **Authentication > Sign-in method**, enable **Email/Password** and **Google**.
3. In **Authentication > Settings > Authorized domains**, add `localhost` plus every production hostname that serves the store.
4. Configure the verification-email and password-reset templates with the store name and production continue URL.
5. Set the Firebase password policy to require at least **8 characters**. The app also enforces this minimum before registration.
6. Copy the web app's `apiKey`, `authDomain`, `projectId`, and `appId` into the matching environment variables above.
7. Give the Node server Firebase Admin credentials through Application Default Credentials. If using a service-account JSON file, store it outside the repository and set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path. On Railway-style hosts, store the complete JSON only in the sealed `FIREBASE_SERVICE_ACCOUNT_JSON` variable.

Restart the server after changing configuration. `GET /api/customer/auth/config` intentionally exposes only the four public web fields. Customer profile, orders, addresses, wishlist, and reviews require a verified Firebase email and a valid bearer ID token.

## 5. Payments (WhatsApp)

Customers pay on WhatsApp: mobile money, bank transfer or cash on delivery. The
site takes no payments itself and holds no payment-provider keys.

1. The customer places the order on the site. It is saved as **Pending**
   (pre-orders as **Awaiting payment**) with an unpaid WhatsApp payment, and the
   installed admin app gets a "New order" alert.
2. WhatsApp opens with the order reference and total; the shop sends the
   payment details there.
3. When the money arrives, open the order in the admin and set it to **Paid**.
   That marks the payment paid with the time, takes the pieces off the shelf
   once, and counts the order on the Payments page and in revenue. Use
   **Payment review** while a payment is being checked.

## 6. Data & backups

- SQLite is authoritative and runs as a **single application instance**. Do not
  scale this service horizontally or attach its `/data` volume to another writer.
- For Railway production, create one Railway Volume mounted at **`/data`**.
  Railway must inject both `RAILWAY_VOLUME_MOUNT_PATH=/data` and
  `RAILWAY_VOLUME_NAME`; never create or edit either injected variable manually.
  The resolved paths are
  `DB_PATH=/data/inventory.db`, `UPLOAD_DIR=/data/uploads`, and
  `BACKUP_DIR=/data/backups`; do not point any of them outside `/data`, and never
  put `DB_PATH` or `BACKUP_DIR` at or beneath the publicly served `UPLOAD_DIR`.
- The database and its `-wal`/`-shm` sidecars hold customer/order data and are
  **gitignored**. Never commit them. Railway health checks call `GET /api/health`,
  which checks SQLite without returning paths, credentials, or record data.
- Railway sends `SIGTERM` during a deploy. Allow the process its **15-second
  drain**: it stops accepting requests, checkpoints WAL, then closes SQLite.
- Run `node server/backup_db.js` daily. It uses SQLite's online backup API,
  verifies `PRAGMA integrity_check`, and retains the 30 newest snapshots in
  `/data/backups`. Also enable Railway Volume backups on a weekly schedule and
  keep at least one tested off-platform copy.

### Safe Railway cutover and restore

**Do not attach a Volume or configure its mount before capture is complete.**
Attaching/configuring a Railway Volume can trigger a deployment; an early deploy
could start the service against an empty database.

1. Keep the old process and its authoritative database running, pause public
   ingress, block new admin writes, and let every in-flight write drain. Do not
   stop or redeploy the old service yet.
2. While the old database remains accessible, run `node server/backup_db.js`
   against it. Require the command's successful `PRAGMA integrity_check`, then
   download the verified snapshot and a complete copy of the existing uploaded
   product images to off-platform storage.
3. Query the old database and record independently checkable evidence: known
   table counts plus several recent order numbers. Keep
   the backup timestamp, integrity result, counts, and order numbers in the cutover
   record. Do not proceed if any capture or verification is incomplete.
4. Only after those artifacts are safely captured, stop the sole service and
   wait for its 15-second drain to finish. Keep public ingress closed.
5. With the service stopped, provision/attach the one Volume at `/data`. Confirm
   Railway injected both `RAILWAY_VOLUME_MOUNT_PATH=/data` and
   `RAILWAY_VOLUME_NAME`; never create either variable manually.
6. Still while stopped, restore the verified snapshot to `/data/inventory.db`
   and restore uploaded images beneath `/data/uploads`. Configure
   `DB_PATH=/data/inventory.db`, `UPLOAD_DIR=/data/uploads`, and
   `BACKUP_DIR=/data/backups`.
7. Start exactly one replica with `node server/server.js`. Require HTTP 200 from
   `/api/health` with
   `{"status":"ok","database":"ready","persistentStorage":true}`, then verify
   the recorded historical counts, order numbers, payment references, and known
   uploaded images against the restored service.
8. Perform one controlled restart, repeat health and historical-record checks,
   record the result, and only then reopen public ingress.

For a later restore into an existing `/data`, first close ingress and stop the
sole service after draining. Preserve the current database plus `-wal`/`-shm` as
an incident copy, restore the verified snapshot and uploads while stopped, and
remove only stale sidecars belonging to that stopped database before step 7.

## 7. Production checklist

- [ ] `NODE_ENV=production` set on the host
- [ ] `JWT_SECRET` is a fresh long random value
- [ ] `ALLOWED_ORIGINS` lists your real domain(s)
- [ ] `OWNER_EMAIL` set to the owner's address alone — so a stranger can't claim owner
- [ ] `GOOGLE_CLIENT_ID` set, with the live address in its Authorized JavaScript origins (§8) — the admin's only sign-in
- [ ] Optional: `RESEND_API_KEY` + `RESEND_FROM` (with a domain verified in Resend) for access-request and new-staff emails
- [ ] `APP_URL` set to your public URL (used in emails)
- [ ] Exactly one Railway replica has a Volume mounted at `/data`
- [ ] Railway injected `RAILWAY_VOLUME_MOUNT_PATH=/data` and `RAILWAY_VOLUME_NAME`; neither was created manually
- [ ] The resolved `DB_PATH`, `UPLOAD_DIR`, and `BACKUP_DIR` stay under `/data`, and private database/backup paths are not beneath uploads
- [ ] Railway and Docker start directly with `node server/server.js`, with `drainingSeconds` set to the string `"15"`
- [ ] Railway health check is `/api/health` and returns HTTP 200 after a controlled restart
- [ ] Daily validated SQLite snapshot and weekly Railway Volume backup configured
- [ ] Served over HTTPS (required for the PWA service worker and HSTS)
- [ ] Production runtime is Node 22.13 or newer
- [ ] Firebase Email/Password and Google providers enabled
- [ ] Firebase authorized domains include localhost and every production hostname
- [ ] Firebase verification/reset templates and 8-character password policy configured
- [ ] All four `FIREBASE_*` public values set
- [ ] Firebase Admin uses ADC/workload identity or an external service-account file
- [ ] A test order placed on WhatsApp, then set to Paid in the admin, shows on the Payments page and in revenue
- [ ] If Cloudflare proxies the domain (orange cloud): SSL/TLS mode is **Full (strict)**. The server already
      recognises Cloudflare's addresses (`server/trusted_proxies.js`), so each shopper keeps their own rate limit;
      if Cloudflare publishes new ranges at <https://www.cloudflare.com/ips>, add them there.

## 8. Admin Google Sign-In setup (required)

"Continue with Google" is the admin's only sign-in. Google proves who someone
is; your `users` table still decides access (approve or reject under Manage Staff).

To set it up:

1. Go to <https://console.cloud.google.com/> → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: set User type **External**, add an
   app name + your support email, and add yourself as a **Test user** (or Publish
   the app once you're ready for all staff).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: add every origin the admin page loads from
     — e.g. `http://localhost:3001` for local, and `https://dckidsbrand.com` for
     production. (No redirect URI is needed — this uses the ID-token flow.)
4. Copy the generated **Client ID** and set it in `server/.env`:
   `GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com`
5. Restart the server. The button appears on the admin sign-in page. If the id is
   unset, the page says sign-in isn't set up; if the id is wrong or the page's
   address isn't an authorized origin, Google's button shows an error instead.

First Google sign-in from a new email creates a `pending` access request (unless
the email is in `OWNER_EMAIL`), which the owner approves under **Manage Staff →
Access Requests**.
