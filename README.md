# Lootrova

Marketplace for digital game items. Anyone can sell; Lootrova keeps a **10% fee** on every completed sale.

## How it works
- Sellers list items and must confirm each one is usable.
- When a buyer purchases, the money is **held** until the buyer clicks "It works" (and rates the seller).
- The seller is then credited the price minus 10%. The buyer can instead mark "Doesn't work", which opens a dispute.
- Payments are not connected yet: balances are tracked in the database only.

## Run
Requires Node 22.5+ (uses the built-in SQLite). No dependencies.

    npm start   # http://localhost:3000
