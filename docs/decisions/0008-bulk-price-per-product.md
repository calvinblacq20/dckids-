# ADR 0008 — A product can carry its own bulk price

**Status:** accepted · **Date:** 2026-11-02

## Decision
`products.wholesale_price` (nullable) is a product's own price per piece when bought in bulk: wholesale orders and bulk China pre-orders. When it is set and below the selling price, a bulk piece costs that price, and differently priced sizes move by the same proportion. When it is empty, the store-wide wholesale discount applies as before. The rule is one function, `bulkFactor`, repeated word for word in the server, storefront, product page and admin; a smoke test fails if a copy drifts. The server's copy is what an order is charged.

## Context
The owner's real bulk prices are per item (boxed slides: GH₵180 each, GH₵150 each from ten), which the store-wide 20% could not express. It gave GH₵144 and undercharged resellers.

## Consequences
- + Exact bulk prices per piece, with the old behaviour unchanged for every product without one.
- + A bulk price that no longer sits below a new selling price is dropped, so a later price rise can't quietly revive an old discount.
- − Four copies of the rule; the drift test is what keeps them honest. Moving pricing entirely server-side would remove the copies but needs the static showcase to stop pricing on its own.
- Additive column (expand-only migration); dropping it later means bulk prices fall back to the store-wide discount.
