# ADR 0010 — The bulk price starts at the minimum; fewer pieces sell at retail

**Status:** accepted · **Date:** 2026-11-02 · amends the MOQ floor in ADR 0008's context

## Decision
In a wholesale order or a bulk China pre-order, a line of at least the minimum order quantity (`store_settings.wholesale_moq`) is charged the bulk price (`bulkFactor`, ADR 0008). A line under the minimum is charged the retail price instead of the order being refused. The rule is one function, `bulkApplies(isWholesale, quantity, minimum)`, repeated word for word in the server, storefront, product page and admin; a smoke test fails if a copy drifts. Both order paths (WhatsApp checkout and Paystack card checkout) use it.

## Context
The MOQ used to be a floor: any wholesale line under it made the server refuse the whole order. In the shop that meant a piece with fewer left than the minimum (117 of 333 in the catalogue at the time) could not be bought in Wholesale at all, with the buttons greyed out. The workaround, switching the shop to Retail, re-priced the buyer's whole cart, so they lost the bulk price on everything else. In admin, the counter form's check for the floor ended in a stray `return` that dropped every wholesale row, so no wholesale order could be taken at the counter.

## Consequences
- + Nothing a wholesale buyer can see is unbuyable for being under the minimum: the last few pieces sell, at retail, beside bulk lines in the same order.
- + No piece ever sells below its retail price for being under the minimum, so the shop gives nothing away. The MOQ still decides who gets the bulk price.
- + The shop never raises a cart quantity to the minimum by itself; a line under it is labelled as retail-priced instead.
- − A wholesale order can now hold retail-priced lines, so its total is not all bulk revenue. Each line's `price_at_time` records what it was charged.
- The Terms page says the same thing: fewer pieces than the MOQ are charged at retail.
