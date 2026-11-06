# ADR 0013 — Customers download their data and delete their account themselves

**Status:** accepted · **Date:** 2026-11-06 · builds on [ADR 0006](0006-firebase-customer-accounts.md)

## Decision
The account page's Profile tab has a **Your data** section with two actions.

- **Download my data** (`GET /api/customer/export`) sends one JSON file: the
  account's email, name and phone, saved addresses, wishlist, reviews, and every
  order linked to the account with its items. It is sent as an attachment with
  `Cache-Control: no-store`, and holds only the signed-in customer's records.
- **Delete my account** (`DELETE /api/customer/me`), after a confirm prompt,
  runs in one transaction:
  - deletes the saved addresses, wishlist and reviews;
  - unlinks the account's orders (`orders.customer_account_id = NULL`) and its
    customer-list entry (`customers.customer_account_id = NULL`);
  - deletes the `customer_accounts` row.

  The page then asks Firebase to delete the sign-in and signs out. Firebase
  only deletes a sign-in that is recent; when it refuses, the sign-in is left
  holding just the email address, and the session still ends.

## Context
Customer accounts are live (Firebase, ADR 0006), and the privacy policy says
customers can have their details deleted. Until now that meant a WhatsApp
message or an email and a manual clean-up. Ghana's Data Protection Act 2012
(Act 843) and the GDPR both give a right of access and a right to erasure, and
a deletion path is much harder to add once data has spread.

## Why orders are kept
Orders are the shop's sales and tax record, and the privacy policy already says
order records are kept "for as long as we need them for business and legal
record-keeping". They keep the name, phone and delivery details typed at
checkout, as any order record does, but nothing ties them to the account any
more. The customer-list entry is unlinked rather than deleted for the same
reason, and so the same phone number can open a new account later
(`syncCustomerDirectoryAccount` refuses a phone that belongs to another account).

## Consequences
- + A customer can see and erase their account data without asking anyone.
- + Erasure is one transaction: it either all happens or none of it does.
- − Reviews are deleted, not anonymised, so a product's rating can change when
  a reviewer leaves.
- − If the customer signs in again with the same verified email, a new, empty
  account is created. Their old orders are not reattached: the one-time legacy
  link only runs for an existing account row that has never used Firebase, and
  that row is gone.
- − Deleting order records themselves still goes through the shop (WhatsApp or
  email), because the owner decides what the law requires her to keep.
