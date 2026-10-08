# ADR 0006 — Customer accounts via Firebase Auth (staff auth unchanged)

**Status:** accepted · **Date:** 2026-08 (recorded 2026-10-08 from the code)

> **Rationale needs the author.** Reconstructed by reading the implementation.
> Decision and Consequences reflect the code; Context is inferred.

## Decision
Shoppers can hold accounts, authenticated by **Firebase Auth** — email/password
with verification, password reset, and Google sign-in (popup-first, with a
redirect fallback). Staff authentication is untouched and remains as recorded
in [ADR 0002](0002-passwordless-admin-auth.md): emailed codes, recovery codes,
no passwords stored.

- `firebase-auth.js` loads the SDK from gstatic and reads its public config
  from `/api/customer/auth/config`; the config values are public identifiers,
  not secrets.
- Server-side verification uses `firebase-admin`; credentials come from the
  environment, never the repository.
- Guest checkout still works — an account is optional, not a gate.
- The project's own local customer-account registration is retired in favour
  of this, asserted by a smoke test.

## Context (inferred — confirm before relying on this)
Card payments and order history benefit from a durable customer identity, and
ADR 0002 deliberately declined to hand-roll auth for staff. Using a managed
provider for the much larger shopper population follows the same reasoning,
and avoids holding shopper passwords at all.

## Consequences
- + No shopper passwords stored; email verification, reset and Google sign-in
  come from the provider rather than being built.
- + Two separate auth systems with separate blast radii: a problem in customer
  auth cannot reach the admin, and vice versa.
- − Two auth systems to understand, and a hard external dependency for
  shoppers: if Firebase is unreachable, sign-in is unavailable. Guest checkout
  is the degradation path.
- − `FIREBASE_PROJECT_ID` unset disables customer sign-in silently (logged at
  boot). Fine locally, a misconfiguration in production.
- − The Content-Security-Policy must allowlist the Firebase and Google origins;
  the storefront and admin therefore need different policies.
- Revisit if shopper auth needs to merge with staff auth, or if the provider's
  pricing or regional availability changes.
