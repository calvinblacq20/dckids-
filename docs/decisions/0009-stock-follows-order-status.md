# ADR 0009 — Stock follows the order's status, once each way

**Status:** accepted · **Date:** 2026-11-02

## Decision
An order's in-stock pieces come off the shelf once, when it first reaches `paid`, `shipped`, `dispatched`, `delivered` or `completed`, and go back once if it leaves those (cancelled, deleted, or moved back to an earlier step). `orders.stock_deducted_at` records which side the order is on, and `syncOrderStock` is the only code that moves stock for an order, inside the same transaction as the status change. Pre-order pieces are sourced on demand, so their stock never moves.

## Context
Stock used to come off only when an order turned `paid`, and nothing ever put it back. An audit found four failures: setting an order back to Paid took its pieces twice, cancelling or deleting a paid order never returned them, an order moved straight to Delivered never took them, and paying for China pre-orders ran down their placeholder stock until the shop showed them as sold out.

## Consequences
- + Stock stays right however staff move an order.
- + Pre-order pieces never sell out because of a stock count.
- − Orders that were already past `paid` before this change are assumed to have had their stock taken (backfilled from `updated_at`). One that had skipped `paid` would have its pieces put back on cancellation without ever having taken them, an edge case only possible for orders from before the change.
- Deleting orders is now owner-only (orders are the shop's financial record; staff cancel instead).
