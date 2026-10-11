# ADR 0003 — SQLite (WAL) with a self-seeding catalogue, on durable storage

**Status:** accepted · **Date:** 2026-06 (recorded 2026-07-17, amended 2026-08-21)

## Decision
The database is a single SQLite file (WAL mode, busy_timeout, FKs on), gitignored. On first boot the schema is created and the catalogue seeds from `products.json` (the committed snapshot), so a fresh clone runs with `npm install && node server.js`.

**Amended 2026-08-21:** path resolution moved into `server/storage.js`. In Railway
production the database, uploads and backups all resolve beneath the mounted
volume (`RAILWAY_VOLUME_MOUNT_PATH`); locally they fall back to `server/` and
the project root. The module refuses to boot in Railway production when the
volume path is missing, and resolves symlinks before writing so a configured
path cannot escape the volume.

## Context
Playbook decision table: prototype / single-operator / local-first → SQLite. One shop, one server, hundreds of orders — Postgres would add ops burden with no benefit at this scale.

The amendment exists because a container filesystem is ephemeral: before it,
the database lived inside the deployed project directory and was recreated on
every deploy. It also sat inside the statically served root, which exposed it
over HTTP until the static mount was guarded.

## Consequences
- + Zero-config, file-based backups (WAL-safe online backup, integrity-checked, keep-30), trivial local dev.
- + Data survives redeploys; one place decides every persistence path.
- − Single-writer model; no managed failover; migrations are hand-rolled additive `ALTER`s.
- − A missing volume is now a hard boot failure in production. That is deliberate — failing loudly beats writing to a disk that disappears.
- Revisit at sustained multi-instance traffic or ~10× order volume → Postgres (Neon/Render), per the scale roadmap: one order of magnitude at a time.
