# Lootrova

Marketplace for digital game items. Products are listed by independent sellers; Lootrova keeps a **10% platform fee** from each successful sale (paid by the seller, never added to the buyer's price).

## Run
Requires Node 22.5+ (uses the built-in SQLite).

    npm install
    npm start   # then open http://localhost:3000

Opening `public/index.html` directly from disk won't work. The site needs the server for data, payments and downloads.

    npm test    # end-to-end API tests for purchases, refunds, downloads and moderation

### Settings (environment variables)
| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `ADMIN_USERS` | none | Comma-separated usernames that get the admin/moderator area, e.g. `ADMIN_USERS=yourname npm start` |
| `CURRENCY` | `GBP` | Currency for prices |
| `HOLD_DAYS` | `7` | Days seller earnings stay pending (buyer protection) |
| `ANTHROPIC_API_KEY` | none | Turns on AI case summaries (advice only; the owner decides every case) and NSFW screening of every uploaded image |
| `SUPPORT_EMAIL` | none | Shown on the Contact page |
| `DB_PATH`, `UPLOAD_DIR`, `FILES_DIR` | project folder | Where the database, public images and private product files are stored |

## How buying works
1. The product page shows the price, seller, what the buyer receives, file type, compatibility, requirements and licence, with a **Buy now** button.
2. Checkout shows an order summary (product, seller, price, service fee, total), an editable receipt email, the card form and an **unticked** digital-content consent box. Payment can't start until it's ticked.
3. **Pay now** creates the order on the server using the server's price and fee, then the card is confirmed with the payment provider. The order only counts as paid after the server re-checks the payment with the provider.
4. The success page has a **Download** button and a receipt. Purchases stay in the buyer's **Library**.
5. Downloads (`/download/<order>`) are checked on the server: logged-in buyer, paid order, not refunded.

## Money
- Every money movement is written to an append-only `ledger` table (purchases, platform fees, seller earnings, releases, refunds, chargebacks, payouts). Balances are sums of the ledger; the database blocks edits and deletes.
- Seller earnings are **pending** for `HOLD_DAYS`, then **available** (sooner if the buyer confirms the item works). Refund requests put them on hold.
- Sellers request payouts of their available balance; admins mark payouts paid or failed.
- Refunds (by the seller, or by an admin) go back through the payment provider and reverse the seller's earnings. Admins can record chargebacks.

## Payments: test mode
`payments.js` is a built-in **test payment provider** that behaves like Stripe's test mode (PaymentIntents, client secrets, server-side confirmation, refunds). It only accepts test cards, e.g. `4242 4242 4242 4242` (succeeds) and `4000 0000 0000 0002` (declined). **No real money can be taken yet.** Card numbers are never stored; only the brand and last 4 digits are kept.

To take real payments, replace the provider with a live one (e.g. Stripe) that has the same methods: `createIntent`, `retrieveIntent`, `cancelIntent`, `confirmIntent` (done by the provider's own card form in production) and `refund`. Payouts to sellers' bank accounts also need a payout provider (e.g. Stripe Connect).

## Selling and moderation
- Listings need a product file, what the buyer receives, compatibility, licence and price, plus two confirmations: the item works, and the seller owns it or has permission to sell it.
- Programs and scripts are blocked from upload; other file types are limited to an allowlist.
- Sellers can edit or remove their own listings only.
- Every product page has **Report product** (including copyright reports that don't need an account).
- Admins (see `ADMIN_USERS`) can review reports, remove listings (optionally disabling downloads for malware or illegal content), suspend sellers, handle refund requests, record chargebacks, process payouts, and read the transaction ledger and support messages.

## Policies
Terms of Service, Privacy, Cookies, Seller Terms, Refund & Dispute, Copyright/IP and Prohibited Products live in `public/policies.js`, and support messages come in through the Contact page. The policy texts are plain-language drafts: have them reviewed by a solicitor before launch.

## Roblox games, confirmations and cases
- Launch games: Pet Simulator 99, Steal a Brainrot, Jailbreak and Blox Fruits (`GAMES` in `server.js`).
- Every order needs **both** confirmations: the seller uploads a screen recording of the trade and confirms delivery, and the buyer confirms receipt. Money is released only when both have confirmed.
- If either side hasn't confirmed by the deadline (`HOLD_DAYS`), or the buyer reports a problem, a **case** opens automatically. Both sides can add notes, screenshots and videos.
- With `ANTHROPIC_API_KEY` set, `ai-review.js` asks Claude to review the case evidence and recommend paying the seller, refunding the buyer, or escalating to a person. Admins make the final decision in Admin → Cases.
- Sellers can switch themselves online or offline. Profiles show their status, average hours online per day (last 30 days) and, after 4 delivered sales, their average delivery time.

## Image safety (NSFW screening)
With `ANTHROPIC_API_KEY` set, every uploaded image (listing photos and case screenshots) is checked by Claude, including tiny, blurry or low-quality images:
- **unsafe**: the listing is removed or the file hidden, and it appears in Admin → Image safety.
- **unsure**: hidden until an admin approves or removes it.
- **safe**: shown normally.

Without a key, images are not screened and Admin → Image safety says so.
