# Hushrate

Autonomous hourly power-allocation agent for bitcoin miners and compute operators. It is intended to buy grid power price and hashprice data per request over x402 from the Telegraph network, decide run or curtail per site, and print a receipt for every decision.

Entry for Telegraph Hackathon Season II, Apps & Agents track, Mission 12 (Mining and Power).

## Status

Data-discovery stage. The decision loop and UI are not built yet. See [docs/probe-report.md](docs/probe-report.md) for what the first paid calls returned and whether the data is usable.

## Layout

- `agent/` Node + TypeScript scripts
- `web/` React + Vite shell (no UI yet)
- `data/discovery/` saved intent schemas and miner listings
- `data/receipts/` decoded payment and Telegraph receipts for each paid call
- `data/verification/` comparison of results with public sources

## Setup

Node 20 or newer.

```bash
npm install
cp .env.example .env   # then set EVM_PRIVATE_KEY (Ethereum Sepolia test wallet only)
```

## Scripts

```bash
npm run probe     # free: fetch intent schemas and miners
npm run wallet    # free: print Sepolia ETH and test USDC balances
npm run ask       # PAID (test USDC): one GRID_POWER_PRICE_GENERAL and one MINING_HASHPRICE_VERIFY_GENERAL call
npm run verify    # free: compare saved results with CAISO OASIS and mempool.space
```

`ask` safeguards: network is pinned to Ethereum Sepolia, at most 4 paid calls per run, at most 3 cents per payment, a payment is never sent twice for one call, and a request already paid for (same intent and params) is skipped on re-run. The key in `.env` is checked against the expected wallet before any payment. Test funds only.

Never commit `.env`.
