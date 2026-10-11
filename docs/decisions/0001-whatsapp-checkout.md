# ADR 0001 — Checkout completes over WhatsApp, no online card payments

**Status:** superseded by [ADR 0005](0005-paystack-card-checkout.md) · **Date:** 2026-06 (recorded 2026-07-17, superseded 2026-08)

## Decision
Orders are placed on the site (name + phone + items; totals computed server-side) and confirmed/paid via WhatsApp — mobile money or cash on delivery. No card gateway is integrated.

## Context
Ghanaian retail customers overwhelmingly transact via WhatsApp + MoMo. Card penetration is low; a card-only checkout would lose sales. Skipping card data also removes the PCI surface entirely for the MVP.

## Consequences
- + Zero card-data liability; checkout matches local buying habits; human review of every order catches edge cases.
- − Payment is manual; no automatic payment state. Mitigated by the order state machine (`pending → paid` deducts stock) and idempotent order creation.
- Revisit when volume makes manual confirmation a bottleneck → Paystack/Flutterwave/MoMo API per the playbook's Ghana module.

## Why this was superseded
The revisit condition above was met. Paystack now runs alongside the WhatsApp
flow rather than replacing it: `POST /api/orders` still handles the WhatsApp
path, and `POST /api/checkout/paystack` handles cards. Both are live, and the
storefront chooses between them per order.

The "zero card-data liability" property is retained — Paystack hosts the
payment page and the app never sees card numbers, so the PCI surface stays with
the provider. What changed is that payment state is now automatic for the card
path, through webhooks and a reconciliation CLI.

See ADR 0005 for the current position.
