# ADR 0012 — Admin sign-in is Google only; emailed and recovery codes are retired

**Status:** accepted · **Date:** 2026-11-03 · supersedes [ADR 0002](0002-passwordless-admin-auth.md)

> **Scope:** staff sign-in only. Shopper accounts are unchanged — see
> [ADR 0006](0006-firebase-customer-accounts.md).

## Decision
The admin has one way in: **Continue with Google**. The 6-digit emailed code,
the one-time recovery codes and the request-access form are removed, with
`POST /api/admin/register`, `/api/auth/request-code`, `/api/auth/verify-code`,
`/api/auth/recovery` and `/api/admin/recovery-codes/*`.

- The `OWNER_EMAIL` address becomes the owner on its first Google sign-in.
  Without `OWNER_EMAIL`, the first person to sign in on a fresh install becomes
  the owner, so a new database still bootstraps.
- Anyone else who signs in with Google for the first time creates a pending
  access request, and the owner approves or rejects it under Manage Staff. An
  account the owner adds herself is active at once. Either way they join as
  staff ([ADR 0007](0007-one-shop-owner.md)).
- The server verifies the Google ID token against `GOOGLE_CLIENT_ID` (Google's
  tokeninfo endpoint), so `GOOGLE_CLIENT_ID` is required in production.
  `RESEND_API_KEY` is now optional: email only carries notifications.
- The `auth_codes` and `recovery_codes` tables are dropped at boot.
  `users.recovery_shown` stays on older databases, unused.

## Context
The owner asked for "a normal sign in format as every other platform". Codes
meant two extra screens and a set of backup codes to keep safe, for a staff of
two or three. It also takes the shop out of the business of sending sign-in
secrets by email, which ADR 0002 accepted as hand-rolled auth.

## Consequences
- + One tap to sign in, nothing to type, store or forward. No sign-in secret is
  ever emailed, stored or printed to a log.
- + Less of our own auth code: no OTP or recovery-code logic, and the bcrypt
  dependency is gone.
- − Every staff member needs a Google account on their staff email address. A
  non-Gmail address works once a Google account is created for it.
- − Google is now a hard dependency for the admin. If Google is unreachable, or
  `GOOGLE_CLIENT_ID` is missing or its authorized JavaScript origins don't list
  the site's address, nobody can sign in. The storefront keeps selling, since
  checkout needs no admin session. The login page says which case it is.
- − Lost access to the owner's Google account means lost access to the admin.
  Recovery goes through Google's own account recovery, or through changing
  `OWNER_EMAIL` on the host and restarting.
- Rolling back to the code sign-in recreates the code tables empty: no old
  emailed or recovery code works again.
- Revisit if staff need to sign in without Google accounts, or if compliance
  demands MFA beyond what Google provides.
