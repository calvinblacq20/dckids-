# ADR 0003 — SQLite (WAL) with a self-seeding catalogue

**Status:** accepted · **Date:** 2026-06 (recorded 2026-07-17)

## Decision
The database is a single SQLite file (WAL mode, busy_timeout, FKs on), gitignored. On first boot the schema is created and the catalogue seeds from `products.json` (the committed snapshot), so a fresh clone runs with `npm install && node server.js`.

## Context
Playbook decision table: prototype / single-operator / local-first → SQLite. One shop, one server, hundreds of orders — Postgres would add ops burden with no benefit at this scale.

## Consequences
- + Zero-config, file-based backups (WAL-safe online backup, daily in-process, keep-30, restore-verified), trivial local dev.
- − Single-writer model; no managed failover; migrations are hand-rolled additive `ALTER`s.
- Revisit at sustained multi-instance traffic or ~10× order volume → Postgres (Render/Neon), per the scale roadmap: one order of magnitude at a time.
