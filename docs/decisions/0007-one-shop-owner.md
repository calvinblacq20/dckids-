# ADR 0007 — The shop has one owner

**Status:** accepted · **Date:** 2026-11-02

## Decision
Exactly one account holds owner powers (the `manager` role): the account whose email is on `OWNER_EMAIL`, or, when `OWNER_EMAIL` is unset, the first sign-up (the earliest active manager). Every other account is staff. The server works the role out on every request (`isShopOwner` in `authenticateToken`), so a row that still says `manager` but isn't the owner only gets staff powers. Adding staff, approving a request and editing an account can only ever produce staff; the owner can't be demoted and her sign-in email can't be changed from the admin.

## Context
The owner asked to be the only owner. Before this, any manager could make another manager from three places in the admin, so owner powers (settings, products, staff, deleting records) could spread without her knowing. Owner identity lives in server configuration rather than in the admin, so it can't be handed over by a mistaken click.

## Consequences
- + Nobody else can change prices, settings or staff, or delete records, whatever the database row says.
- + Staff keep working on orders exactly as before.
- − Changing the owner means changing `OWNER_EMAIL` on the host and restarting. That is deliberate.
- − If `OWNER_EMAIL` lists several addresses, they are all owners. Set it to her address alone.
