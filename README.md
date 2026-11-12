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
npm run sample    # PAID (test USDC): direct calls to chosen miners, checked against public sources
npm run verify    # free: compare saved results with CAISO OASIS and mempool.space
```

```bash
npm run agent               # one allocation cycle: buys hashprice (test USDC), prints a receipt per site
npm run agent -- --no-pay   # same, public sources only, spends nothing
npm run agent -- --loop     # repeat at 5 minutes past each UTC hour
npm test                    # hand-computed checks of the run/curtail math
```

## Dashboard

```bash
npm run dev -w web      # local dev server
npm run build -w web    # static build in web/dist
```

The dashboard shows the latest decision per site, where each number came from, the Telegraph payment receipt, and a history table. It bundles the saved files in `data/decisions/` and `data/receipts/` at build time, so rebuild after running the agent. It shows nothing that was not saved by the agent.

## How a cycle decides

1. Fetch the latest Bitcoin block height, the BTC/USD price and the block's own reward and difficulty from mempool.space, and compute the public hashprice for that block.
2. Buy the same hashprice from Telegraph miner 71083 (`POST /engine/v1/ask/71083`, $0.01 test USDC). Use it only if the call succeeds, every field is `ok`, the returned height matches, and the value is within 1% of the public computation. Otherwise fall back to the public value and say so on the receipt.
3. Fetch the CAISO day-ahead LMP for each site's node for the current UTC hour from CAISO OASIS. If it is unavailable the site gets `HOLD (no power price)`, never a guessed value.
4. For each site in `config/sites.json`: revenue = fleet hashrate x hashprice x BTC price; cost = fleet energy per day x (LMP + adder). `RUN` if margin exceeds the site's threshold, else `CURTAIL`. The receipt also shows the breakeven LMP.
5. Print the receipt and save it to `data/decisions/`.

Telegraph's power-price intent is not used for decisions: in testing it was wrong or unavailable (see the probe report). `config/sites.json` holds operator assumptions (fleet size, efficiency, adder), not market data; replace them with your own.

Known limits: hashprice is gross for a single block, so unusually large fees in that block move it; the decision is per hour with no ramp or restart cost modelling; the agent prints decisions and does not control hardware.

`ask` safeguards: network is pinned to Ethereum Sepolia, at most 4 paid calls per run, at most 3 cents per payment, a payment is never sent twice for one call, and a request already paid for (same intent and params) is skipped on re-run. The key in `.env` is checked against the expected wallet before any payment. Test funds only.

Never commit `.env`.
