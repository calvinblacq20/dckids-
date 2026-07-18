# ADR 0001 — Checkout completes over WhatsApp, no online card payments

**Status:** accepted · **Date:** 2026-06 (recorded 2026-07-17)

## Decision
Orders are placed on the site (name + phone + items; totals computed server-side) and confirmed/paid via WhatsApp — mobile money or cash on delivery. No card gateway is integrated.

## Context
Ghanaian retail customers overwhelmingly transact via WhatsApp + MoMo. Card penetration is low; a card-only checkout would lose sales. Skipping card data also removes the PCI surface entirely for the MVP.

## Consequences
- + Zero card-data liability; checkout matches local buying habits; human review of every order catches edge cases.
- − Payment is manual; no automatic payment state. Mitigated by the order state machine (`pending → paid` deducts stock) and idempotent order creation.
- Revisit when volume makes manual confirmation a bottleneck → Paystack/Flutterwave/MoMo API per the playbook's Ghana module.
