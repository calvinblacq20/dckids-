# ADR 0004 — Vanilla HTML/CSS/JS frontend; Tailwind pre-built, not runtime

**Status:** accepted · **Date:** 2026-06, amended 2026-07-17 and 2026-08

## Decision
No frontend framework and no bundler. Tailwind is compiled ahead of time into purged stylesheets via `npm run build:css` — `tailwind-storefront.css` (~22KB) for the shop and `tailwind-admin.css` for the dashboard. The runtime Play CDN is used by neither.

## Context
Target market is low-bandwidth mobile Ghana: the playbook's category prescription is "minimal, light-first, CSS-only animation — speed is the wow." A framework plus a runtime CSS compiler (~300KB in the browser) taxed exactly the customers we serve.

The storefront was converted first, in July. The admin followed, so the earlier
caveat in this record — that the dashboard still loaded the Play CDN — no
longer applies.

## Consequences
- + Fast first paint on 3G and cheap Android; no build step for day-to-day edits; the service worker plus `products.json` give an offline fallback.
- + Dropping the runtime compiler also removed the need for `'unsafe-eval'` when the Content-Security-Policy shipped.
- − Large hand-rolled JS files (`app.js`, `admin.js`) need discipline; ESLint in CI guards them.
- − Adding new Tailwind classes requires one rebuild command; forgetting it is the usual cause of "my class did nothing".
- − `admin.html` still carries ~518 inline `on*=` handlers, which is why the CSP keeps `'unsafe-inline'`. Refactoring those out is the follow-up that lets it go.
- Revisit only if the team grows and componentization pays for itself.
