# Hushrate probe report

Date: 2026-11-12. Network: Ethereum Sepolia (eip155:11155111), test USDC only. No real money, no mainnet.
Node: `https://devnode.telegraphprotocol.com`.

## What was called

| | Intent | Params | Miner | field_status | Cost |
|---|---|---|---|---|---|
| A | `GRID_POWER_PRICE_GENERAL` | `node_or_zone=TH_SP15_GEN-APND`, `interval_start=2026-11-12T15:00:00Z` | 302 ChainSight | `lmp_usd_per_mwh: ok`, `node_or_zone: ok`, `market: missing`, `interval_start: rejected`, `currency: missing` | $0.01 |
| B | `MINING_HASHPRICE_VERIFY_GENERAL` | `block_height=975569` (live tip from mempool.space) | 67004 Mempool Mining Pools | `block_height: ok`, `hashprice_usd_per_ph_day: missing`, `hashprice_sats_per_ph_day: missing`, `hashrate_eh_s: missing` | $0.01 |

Free discovery (`/engine/v1/intents/{name}` and `/api/miners?intent={name}`) was saved for four intents under `data/discovery/`.
`DATACENTER_TELEMETRY_VERIFY_GENERAL` and `SLA_COMPLIANCE_GENERAL` were discovered only, not called.

Cost spent: $0.02 test USDC (2 paid calls, cap of 4 per run, 3 cent per-payment cap).
Wallet `0x3F85…C913e` after: 0.1 Sepolia ETH, 0.98 test USDC (before: 0.1 ETH, 1.00 USDC).
Receipts (decoded `PAYMENT-RESPONSE` and `X-TELEGRAPH-RECEIPT`): `data/receipts/`. Verification output: `data/verification/`.

## Data-reality check

| Intent | Miner value | Independent source | Reference value | Result |
|---|---|---|---|---|
| Grid power price | 42.7 USD/MWh | CAISO OASIS `PRC_LMP`, DAM, LMP, TH_SP15_GEN-APND, 15:00 UTC | 32.1996 USD/MWh | **Mismatch** (+10.50, about 33% high) |
| Hashprice | all null | n/a | n/a | **No data returned** |
| Block height echo | 975570 (requested 975569) | mempool.space tip 975569 | 975569 | **Mismatch** (off by one, and the miner reported a height above the real tip) |
| Hashrate | null | mempool.space 3-day current hashrate | about 942 EH/s | **No data returned** |

Notes:
- Both calls returned HTTP 200 and were billed. The node's own field status already flagged the problems (`rejected`, `missing`), so a consumer must check `field_status` and never trust `result` alone.
- The CAISO comparison uses the DAM LMP component for the hour starting 15:00 UTC. Real-time prices differ, and the miner's `market` field was missing, so we cannot say which market it intended. Even so, 42.7 does not match the day-ahead value for that interval.
- I did not compute a hashprice figure myself to compare, because the miner returned none.

## Per-intent verdict

- `GRID_POWER_PRICE_GENERAL`: **not usable as is.** The one paid answer disagrees with the public CAISO figure and the miner did not confirm interval or market. The catalogue lists ten "CAISO NP15 DAM LMP" miners at $0.00 base cost, but the node routed this request to ChainSight (302). Routing directly to a specific miner, and re-testing, is untried.
- `MINING_HASHPRICE_VERIFY_GENERAL`: **not usable.** No hashprice or hashrate was returned.
- `DATACENTER_TELEMETRY_VERIFY_GENERAL`, `SLA_COMPLIANCE_GENERAL`: **not tested** (no paid calls made).

## Recommendation

On this evidence, Mission 12 data quality is **not good enough yet** to drive run or curtail decisions from the node alone. One sample per intent is thin, but both samples failed. Hushrate should:
1. Treat any result whose `field_status` is not `ok` for every required field as invalid, and refuse to decide on it.
2. Cross-check power price against a free public ISO source before acting, and record both on the receipt.
3. Try direct calls to specific miners (`/engine/v1/ask/{minerId}`) for the CAISO and hashprice intents before concluding the network cannot serve them.

Open question for the next step: whether to spend a few more test cents sampling alternative miners, or build the decision loop around public sources with Telegraph as a verification layer.
