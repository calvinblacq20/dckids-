# ADR 0011 — Payments return to WhatsApp only; the card checkout is retired

**Status:** accepted · **Date:** 2026-11-03 · supersedes [ADR 0005](0005-paystack-card-checkout.md), reinstates [ADR 0001](0001-whatsapp-checkout.md)

## Decision
Every order is placed on the site and paid on WhatsApp: mobile money, bank
transfer or cash on delivery. The Paystack card checkout is removed, including
`POST /api/checkout/paystack`, the payment status and webhook routes, the
return page (`payment-result.html`), the reconciliation CLI and the
`PAYSTACK_*` settings.

A payment reaches the books when staff record it. In the admin, opening the
order and setting it to **Paid** marks its payment row paid with the time,
takes the pieces off the shelf once, and counts the order in revenue and on the
Payments page under the method "WhatsApp".

## Context
The owner decided that all payments go through WhatsApp. This also removes the
main cost ADR 0005 recorded: two checkout paths whose pricing and validation
had already drifted apart once.

## Consequences
- + One checkout path, so the drift ADR 0005 warned about cannot recur.
- + No webhook to keep reachable and no payment-provider secret on the server.
- − Payment state is manual again. An order stays unpaid until staff record
  it, so stock and takings are only as current as the shop's habit of marking
  orders Paid.
- − The admin records *that* an order was paid, not *how*: no mobile-money
  transaction ID or method is captured. Revisit when payments need matching
  against MoMo or bank statements.
- Existing data is kept. The payment-provider columns and the `payment_failed`
  status stay, so older orders remain readable and can still be moved to Paid
  or Cancelled. `payment_review` remains as a manual "checking payment" step.
- DC Kids no longer relays Paystack events for other apps. If Akua POS
  (`AKUA-` references) or the other app still share that Paystack account, its
  webhook must point at them directly.
- The reconciliation tool for the 19 August 2026 incident is gone from the
  tree. If that incident is still open, the tool and its instructions are at
  commit `6df6f01` (`server/reconcile_paystack.js`, DEPLOYMENT.md §6).
