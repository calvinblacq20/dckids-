# Ship Checklist — DC Kids Brand (run before EVERY launch/major deploy)

Status as of 2026-11-06 (master playbook sweep against the code, the repo and the live Railway site). [x] verified · [ ] open, with ⚠️ for what is needed at deploy and ❌ for not done.

## Security
- [x] Per-record authorization (SQLite has no RLS): every admin route checks the signed-in account on each request; owner-only routes accept only the shop's one owner (ADR 0007); tracking is gated by the phone's last four digits; customer endpoints need a verified Firebase sign-in and read only that customer's rows. Test-proven, including a stray manager row getting staff powers only.
- [x] No keys in frontend: no build step, no secrets in storefront or admin JS. A full git-history scan finds only example placeholders and the development JWT default, which production refuses to start with.
- [x] Rate limiting: global 120/min/IP in production plus per-endpoint limiters (Google sign-in, tracking, reviews, WhatsApp sign-ups). ⚠️ Re-verify live 429s on the deploy (localhost is exempt).
- [x] IDOR: tracking with the wrong phone → 403; owner-only routes → 403 for staff; staff can't make themselves or anyone else an owner (tests).
- [x] Errors: generic messages to users, details in server logs; unknown API paths answer JSON 404.
- [x] CORS: in production only the shop's own hostname and `ALLOWED_ORIGINS` pass; any other site gets a 403 (`test_origin_policy.js` boots the server in production mode). ⚠️ Add the custom domain to `ALLOWED_ORIGINS` when it is connected.
- [x] Uploads: owner-only, png/jpg/webp, 5 MB cap, server-made names; gallery paths must be files the site already serves.
- [x] `npm audit --omit=dev`: 0 high/critical. 6 moderate remain, all under `@google-cloud/firestore`, an optional `firebase-admin` dependency the server never loads. Dev tooling is reported separately in CI.
- [x] Dependencies added this cycle: none. `firebase-admin` upgraded 13 → 14, which cleared the advisories in the sign-in path.
- [x] Logout ends the session on the server (`admin_sessions`), and Settings → Sign out of all devices ends every session; a copied token is refused after logout. Deleting or demoting an account ends it immediately (tests).
- [ ] GitHub: ❌ the repo is public with secret scanning, push protection and Dependabot off, and `main` is unprotected. Turn all three on and require CI before merging.
- [ ] Staging behind auth: ❌ no staging environment (the Vercel preview is static: no order data, and no admin sign-in without the server).
- [x] Header config in the repo: CSP (enforcing), nosniff, frame, referrer, permissions, `X-XSS-Protection: 0` (OWASP-correct, deliberate), HSTS in production; `vercel.json` carries the same for the showcase.
- [ ] External scans: ⚠️ securityheaders.com and checkvibe.dev / vibelegit.io against the live domain after deploy. Live headers checked by hand 2026-11-06: HSTS, CSP, nosniff, frame, referrer and permissions present, `X-Powered-By` off; the CSP allows inline scripts because the pages use inline handlers (deliberate for now).
- [x] Private paths: `/server/*`, `/docs/*`, `.env`, `.git`, `*.db`, `*.md` and `package.json` answer 404 on the live site; admin APIs answer 401 signed out.

## Completeness
- [x] Privacy policy and terms in the footer; the privacy policy covers orders, the WhatsApp list, accounts, staff alerts, sharing, retention and deletion.
- [x] Loading, empty and error states, including the outage paths: checkout falls back to WhatsApp when the order service is down; admin reports failed deletes and failed Customers/Suppliers loads instead of faking success or spinning forever.
- [x] Custom 404 page (`404.html`, served by the server and by Vercel).
- [x] Open Graph: the home page, and product links shared on WhatsApp preview with the product's own name, price and photo on the live server.
- [x] Mobile verified on real devices (owner and external reviewer); new screens checked at phone width.
- [ ] SEO: robots.txt and sitemap.xml present. ⚠️ Connect Google Search Console and Bing Webmaster at launch, and submit the sitemap.
- [ ] Image licensing: ❌ several China pre-order photos carry stock-site watermarks (Alamy, iStock, Vecteezy, Storyblocks, Adobe Stock) or brand logos (LV, Hermès). Replace them in admin before promoting the window.
- [ ] Catalogue: ⚠️ 24 of 30 pre-order pieces have no price during the open window (3–13 Nov), and no shop piece has a description, so product pages and WhatsApp previews use the generic text.
- [x] Payments: WhatsApp checkout with totals computed server-side; staff record each payment as Paid in the admin, which updates takings, revenue and stock (tests).

## Deploy safety
- [x] Env vars fail loudly: production refuses to start without a strong JWT_SECRET; a missing GOOGLE_CLIENT_ID or RESEND_API_KEY is a boot warning, so the shop keeps selling.
- [x] `GOOGLE_CLIENT_ID`: set on Railway; admin sign-in works on the live address. ⚠️ Add the custom domain to the OAuth client's Authorized JavaScript origins when it is connected (ADR 0012).
- [ ] `OWNER_EMAIL`: ⚠️ set to the owner's address only, or other listed addresses stay owners (ADR 0007).
- [ ] Backups: the app takes a daily online backup (RUNBOOK). ⚠️ Confirm it runs on the host, keep one copy off the host, and run one restore drill.
- [ ] Rollback: ⚠️ pin the previous deploy on the host before each deploy.
- [ ] Deploy gate: ⚠️ turn on Railway's "Wait for CI" so a red build never goes live (Railway deploys every push to `main`).
- [x] Migrations: this cycle added `products.wholesale_price` and `orders.stock_deducted_at` (backfilled) and dropped the retired `auth_codes` / `recovery_codes` tables (ADR 0012), all proven on fresh and existing databases.

## Quality gates
- [x] CI green on main: lint + tests + audit (high) + secret scan over the full history + SAST on every push.
- [x] Tests: `npm test`, 14 suites; the end-to-end smoke suite runs 423 checks on a throwaway database.
- [ ] Lighthouse 90+: ⚠️ run against the live domain after deploy.
- [x] Basic a11y on new screens: labelled inputs, alt text, visible focus, 44px tap targets.

## Operations
- [ ] Error tracking/alerts: ❌ the owner gets Web Push and an email for every new order and a morning summary, but server errors only go to host logs. At minimum, check host logs weekly.
- [ ] Uptime monitor on `/healthz`: ❌ add a free monitor (e.g. UptimeRobot).
- [ ] Billing alerts on the host: ❌.
- [ ] Monthly dependency update and quarterly restore drill: ❌ schedule them.

## Built to last
- [x] ADRs for irreversible decisions (docs/decisions 0001–0013).
- [x] RUNBOOK with backups/restore and degradation paths.
- [x] Health endpoints: `/healthz` (process up), `/readyz` and `/api/health` (SQLite ready).
- [x] Idempotency keys on order creation.
- [x] Append-only admin audit log on sensitive actions.
- [x] E-commerce domain module: stock holds for open orders, stock moving once each way with order status (ADR 0009), whitelisted statuses, completed and cancelled orders reopened only on an explicit confirm, pre-orders sourced on demand.
- [x] Data export/deletion: customers download their data or delete their account on the account page; orders stay as sales records, unlinked (ADR 0013).

## Unhappy paths (tested deliberately)
- [x] Empty and malformed forms and payloads rejected (client and server).
- [x] A credential Google doesn't vouch for → 401; pending and rejected accounts can't sign in; the sign-in limiter caps attempts.
- [x] Other users' URLs: tracking with the wrong phone → 403; owner-only routes → 403 for staff.
- [x] Server down: admin says so instead of faking success; shop checkout sends the order on WhatsApp.
- [ ] Network drop mid-checkout / double-submit: idempotency key prevents duplicates (tested). ⚠️ Retest by hand on the live deploy.
