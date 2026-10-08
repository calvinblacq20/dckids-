# ADR 0005 — Online card payments via Paystack, alongside WhatsApp

**Status:** accepted · **Date:** 2026-08 (recorded 2026-10-08 from the code)

> **Rationale needs the author.** This record was reconstructed by reading the
> implementation, so the Decision and Consequences describe what the code does
> and can be trusted. The Context is inferred — the person who made the call
> should confirm or replace it before this is treated as settled.

## Decision
Card payments run through Paystack, alongside rather than instead of the
WhatsApp flow. This supersedes [ADR 0001](0001-whatsapp-checkout.md).

- `POST /api/checkout/paystack` prices the cart, creates the order inside a
  `BEGIN IMMEDIATE` transaction, and returns a hosted authorization URL.
- References are `DCK-<orderId>-<random>`; the app never sees card numbers.
- Webhooks drive payment state; signature-verified, with forwarding for the
  AKUA and legacy routes.
- `server/reconcile_paystack.js` is an idempotent CLI for repairing missed
  payments, defaulting to dry-run and requiring explicit verified-export and
  backup attestations before it will apply anything.

## Context (inferred — confirm before relying on this)
ADR 0001 named the trigger for revisiting: "when volume makes manual
confirmation a bottleneck". Adding cards while keeping WhatsApp suggests the
aim was to automate payment state without losing customers who prefer mobile
money or cash on delivery.

## Consequences
- + Payment state becomes automatic for the card path; stock deducts on
  verified payment rather than manual review.
- + PCI surface stays with the provider — Paystack hosts the payment page.
- + Reconciliation is a first-class tool, not a manual database edit.
- − Two checkout paths to keep correct. They do not share pricing code, and
  the card path was missing the stock-reservation check the WhatsApp path had
  (fixed 2026-10); any future change to pricing or validation must be applied
  to both, or they will drift again.
- − Webhook delivery is now a correctness dependency: a missed webhook means a
  paid order stuck in `awaiting_payment` until reconciliation runs.
- Revisit if a second provider is needed (Flutterwave, MoMo direct) — at that
  point the two bespoke paths should be collapsed behind one interface.
