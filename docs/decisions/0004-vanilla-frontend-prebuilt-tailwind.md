# ADR 0004 — Vanilla HTML/CSS/JS frontend; Tailwind pre-built, not runtime

**Status:** accepted · **Date:** 2026-06, amended 2026-07-17

## Decision
No frontend framework and no bundler. The storefront's Tailwind is compiled ahead of time into a purged stylesheet (`tailwind.store.css`, ~22KB) via `npm run build:css`; the runtime Play CDN was removed from the storefront (the admin still uses it — smaller audience, larger refactor).

## Context
Target market is low-bandwidth mobile Ghana: the playbook's category prescription is "minimal, light-first, CSS-only animation — speed is the wow." A framework + runtime CSS compiler (~300KB) taxed exactly the customers we serve.

## Consequences
- + Fast first paint on 3G/cheap Android; no build step for day-to-day edits; SW + `products.json` give an offline fallback.
- − Large hand-rolled JS files (app.js/admin.js) need discipline (ESLint in CI guards them); adding NEW Tailwind classes requires one rebuild command.
- Revisit only if the team grows and componentization pays for itself.
