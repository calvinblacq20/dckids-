# Ship Checklist — DC Kids Brand (run before EVERY launch/major deploy)

Status as of 2026-11-02 (master playbook run). [x] verified · [ ] open, with ⚠️ for what is needed at deploy and ❌ for not done.

## Security
- [x] Per-record authorization (SQLite has no RLS): every admin route checks the signed-in account on each request; owner-only routes accept only the shop's one owner (ADR 0007); tracking is gated by the phone's last four digits; customer endpoints are flag-gated. Test-proven, including a stray manager row getting staff powers only.
- [x] No keys in frontend: no build step, no secrets in storefront or admin JS. A full git-history scan finds only example placeholders and the development JWT default, which production refuses to start with.
- [x] Rate limiting: global 120/min/IP in production plus per-endpoint limiters (login, register, tracking, reviews, sign-ups). ⚠️ Re-verify live 429s on the deploy (localhost is exempt).
- [x] IDOR: tracking with the wrong phone → 403; owner-only routes → 403 for staff; staff can't make themselves or anyone else an owner (tests).
- [x] Errors: generic messages to users, details in server logs; unknown API paths answer JSON 404.
- [ ] CORS: `ALLOWED_ORIGINS` allowlist is enforced in production. ⚠️ Set it on the host and confirm a cross-origin request fails.
- [x] Uploads: owner-only, png/jpg/webp, 5 MB cap, server-made names; gallery paths must be files the site already serves.
- [x] `npm audit`: 0 high/critical. 13 moderate remain (eslint dev tooling; Google libraries under `firebase-admin`), fixable only with breaking upgrades. Handle in the monthly update.
- [x] Dependencies added this cycle: none.
- [ ] Logout: the session is re-checked on every request, so deleting or demoting an account ends it immediately. ⚠️ Signing out clears the device only; the 12-hour token is not revoked on the server.
- [ ] Staging behind auth: ❌ no staging environment (the Vercel showcase is static, with no order data).
- [x] Header config in the repo: CSP (enforcing), nosniff, frame, referrer, permissions, `X-XSS-Protection: 0` (OWASP-correct, deliberate), HSTS in production; `vercel.json` carries the same for the showcase.
- [ ] External scans: ⚠️ securityheaders.com and checkvibe.dev / vibelegit.io against the live domain after deploy.

## Completeness
- [x] Privacy policy and terms in the footer; the privacy policy covers orders, the WhatsApp list, accounts, staff alerts, sharing, retention and deletion.
- [x] Loading, empty and error states, including the outage paths: checkout falls back to WhatsApp when the order service is down; admin reports failed deletes and failed Customers/Suppliers loads instead of faking success or spinning forever.
- [x] Custom 404 page (`404.html`, served by the server and by Vercel).
- [x] Open Graph: the home page, and product links shared on WhatsApp preview with the product's own name, price and photo on the live server.
- [x] Mobile verified on real devices (owner and external reviewer); new screens checked at phone width.
- [ ] SEO: robots.txt and sitemap.xml present. ⚠️ Connect Google Search Console and Bing Webmaster at launch, and submit the sitemap.
- [ ] Image licensing: ❌ several China pre-order photos carry stock-site watermarks (Alamy, iStock, Vecteezy, Storyblocks, Adobe Stock) or brand logos (LV, Hermès). Replace them in admin before promoting the window.
- [x] Payments: WhatsApp checkout with totals computed server-side; Paystack (when on) priced by the same rule and reconciled by webhook (tests).

## Deploy safety
- [x] Env vars fail loudly: production refuses to start without JWT_SECRET or RESEND_API_KEY.
- [ ] `OWNER_EMAIL`: ⚠️ set to the owner's address only, or other listed addresses stay owners (ADR 0007).
- [ ] Backups: the app takes a daily online backup (RUNBOOK). ⚠️ Confirm it runs on the host, keep one copy off the host, and run one restore drill.
- [ ] Rollback: ⚠️ pin the previous deploy on the host before each deploy.
- [x] Migrations: additive only; this cycle added `products.wholesale_price` and `orders.stock_deducted_at` (backfilled), both proven on fresh and existing databases.

## Quality gates
- [x] CI green on main: lint + tests + audit (high) on every push.
- [x] Tests: `npm test`, 12 suites; the end-to-end smoke suite runs 324 checks on a throwaway database.
- [ ] Lighthouse 90+: ⚠️ run against the live domain after deploy.
- [x] Basic a11y on new screens: labelled inputs, alt text, visible focus, 44px tap targets.

## Operations
- [ ] Error tracking/alerts: ❌ Web Push covers new and paid orders only; server errors go to host logs. At minimum, check host logs weekly.
- [ ] Uptime monitor on `/api/health`: ❌ add a free monitor (e.g. UptimeRobot).
- [ ] Billing alerts on the host: ❌.
- [ ] Monthly dependency update and quarterly restore drill: ❌ schedule them.

## Built to last
- [x] ADRs for irreversible decisions (docs/decisions 0001–0010).
- [x] RUNBOOK with backups/restore and degradation paths.
- [x] Health endpoint (`/api/health`) proves SQLite readiness.
- [x] Idempotency keys on order creation and Paystack starts.
- [x] Append-only admin audit log on sensitive actions.
- [x] E-commerce domain module: stock holds for open orders, stock moving once each way with order status (ADR 0009), whitelisted statuses, pre-orders sourced on demand.
- [ ] Data export/deletion: by request on WhatsApp or email (privacy policy). ⚠️ No self-serve flow while customer accounts are off.

## Unhappy paths (tested deliberately)
- [x] Empty and malformed forms and payloads rejected (client and server).
- [x] Wrong OTP ×5 → code invalidated; limiter caps requests.
- [x] Other users' URLs: tracking with the wrong phone → 403; owner-only routes → 403 for staff.
- [x] Server down: admin says so instead of faking success; shop checkout sends the order on WhatsApp.
- [ ] Network drop mid-checkout / double-submit: idempotency key prevents duplicates (tested). ⚠️ Retest by hand on the live deploy.
