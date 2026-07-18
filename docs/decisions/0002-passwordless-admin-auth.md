# ADR 0002 — Passwordless admin auth (email OTP + recovery codes + optional Google)

**Status:** accepted · **Date:** 2026-07-15 (recorded 2026-07-17)

## Decision
Staff sign in with a 6-digit emailed code (Resend), backed by one-time recovery codes and optional Google Sign-In. No passwords are stored. First allowlisted email (OWNER_EMAIL) bootstraps the owner; everyone else goes through owner approval.

## Context
The playbook says "never hand-roll auth" — this deliberately deviates. Managed providers (Supabase/Auth0/Clerk) would add an external dependency and monthly cost for a 2–3 person staff, and the stack is vanilla Express with no provider SDK fit. The blast radius is small (staff only; shoppers have no accounts).

## Consequences
- + Nothing to phish or forget; no password database to protect; codes are bcrypt-hashed, 10-min expiry, 5 attempts, one active code; sessions revoke instantly (per-request account re-check); every path covered by smoke tests.
- − We own the auth code. Mitigations: 47-test suite, rate limiters, production refuses to boot without RESEND_API_KEY.
- Revisit if staff count grows past ~10 or compliance demands MFA → move to a managed provider then.
