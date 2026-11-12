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

## Round 2: direct miner sampling

Direct calls to `POST /engine/v1/ask/{minerId}` with the same `intent` + `params`. Script: `agent/src/sample.ts`. Raw output: `data/verification/sample-*.json`, receipts in `data/receipts/`.

| Miner | Intent | Outcome | Cost |
|---|---|---|---|
| 92881 CAISO NP15 DAM LMP B | grid power, `TH_NP15_GEN-APND` | HTTP 503 before payment: `/query` has no field for `node_or_zone`, `interval_start` | $0 |
| 93133 CAISO NP15 DAM LMP C | grid power, `TH_NP15_GEN-APND` | Same 503 before payment | $0 |
| 71083 Bitcoin Block Hashprice | hashprice, block 975569 | HTTP 200; `hashprice_sats_per_ph_day`, `block_height`, `hashrate_eh_s` all `ok`; `hashprice_usd_per_ph_day` `missing` | $0.01 |
| 4283 Gauge | hashprice, block 975569 | HTTP 500, upstream timeout. Payment settled, then credited to escrow ("escrow_credit_pending"), nothing billed | $0.01 paid, refund pending |

Wallet: 0.98 test USDC before, 0.96 after. The ETH balance read 0.2 at this stage versus 0.1 earlier; no funds were sent by these scripts, so it was topped up from elsewhere.

Independent check for miner 71083: I computed the hashprice from mempool.space data for block 975569 (reward 315,803,277 sats including fees, difficulty 148,364,561,003,867) as `reward * 1e15 * 86400 / (difficulty * 2^32)`, giving 42,819.376 sats/PH/day. The miner returned 42,819.376 sats/PH/day. **Match** (relative difference about 4e-12). Its `hashrate_eh_s` was 1,062 EH/s against the 942 EH/s mempool.space 3-day average; these measure different things, so I do not call that a match or a mismatch.

Not verified: USD hashprice (not returned), and whether the CAISO NP15 miners work with their native request form (probing costs money, because the node checks payment before validating native bodies).

Revised verdicts:
- `MINING_HASHPRICE_VERIFY_GENERAL`: **usable when pinned to a good miner** (71083 verified on one block). The router's first pick (67004) was not usable and miner 4283 timed out, so pin the miner and re-verify against the public formula on every call.
- `GRID_POWER_PRICE_GENERAL`: **still not usable.** The router's miner (302) was off by about 33%, and the CAISO-specific miners reject the canonical params. No verified CAISO price source through Telegraph yet.

## Round 3: power-price retest (2026-11-12, 16:07 UTC)

Script: `agent/src/retest.ts` (`npm run retest -w agent`). Raw output: `data/probe/power-retest-*.json`, receipts in `data/receipts/`. Reference: CAISO OASIS day-ahead LMP for `TH_SP15_GEN-APND`, hour starting 16:00 UTC = **13.27178 USD/MWh**. The node ids, the RFC 3339 `interval_start` and the intent schema (`node_or_zone`, `interval_start`) follow the docs at `/docs/using/intent-schema`.

| Attempt | Outcome | Cost |
|---|---|---|
| Router, `intent` + `params` | HTTP 200 from miner 302 (ChainSight): `lmp_usd_per_mwh` 42.7, `field_status`: lmp `ok`, `market` `missing`, `interval_start` `rejected`, `currency` `missing`. **29.43 above CAISO.** | $0.01 |
| Router, `intent` + free-text `query` | HTTP 200 from miner 302 again: 42.8, `market` `rejected`, `interval_start` `missing`. **29.53 above CAISO.** | $0.01 |
| Direct to miner 92881 (CAISO NP15 DAM), `intent` + `query` | HTTP 503 before payment: `/query` has no field for `node_or_zone`, `interval_start` | $0 |

Result: **still not usable.** The one miner that answers returns about the same figure (42.7 to 42.8) in two modes and in the earlier 15:00 UTC call (42.7), while the CAISO SP15 day-ahead price moved from 32.20 (15:00) to 13.27 (16:00). It never confirms the interval or market. Hushrate therefore keeps `power_miner: null` in `config/agent.json`, so it does not pay for power price every hour, and uses CAISO OASIS directly (real-time first, day-ahead otherwise). If a Telegraph miner is later proven, setting `power_miner` makes the agent buy and cross-check it automatically (accepted only within the larger of $1 or 3% of CAISO day-ahead).

## Other Mission 12 intents

- `DATACENTER_TELEMETRY_VERIFY_GENERAL` takes one param, `facility` (a data centre, rack or device), and returns `power_kw` (the only on-chain scored field). Hushrate holds only market data and the operator's own site parameters typed in the browser; it has no facility identifier with a telemetry source behind it, so there is no real input to send. Not used, not called.
- `SLA_COMPLIANCE_GENERAL` takes `service` and `period` and returns `uptime_pct`. The product makes no uptime claims about any service. Not used, not called.
- Both schemas are saved in `data/discovery/`. They would become relevant if an operator supplied a facility or service to verify; that is outside this build.

## Hashprice acceptance rule

The agent requires `hashprice_sats_per_ph_day`, `block_height` and `hashrate_eh_s` to be `ok`, the returned height to equal the requested tip, and the value to be within 1% of the public 144-block mean. Miner 71083 returns `hashprice_usd_per_ph_day` as `missing`; this is not required because USD is computed locally from the public BTC price. Telegraph computes a single block, so its value and the 144-block mean can differ by the block's fee noise; when they differ by more than 1% the public value is used and the receipt says why.

## Recommendation

On this evidence, Mission 12 data quality is **not good enough yet** to drive run or curtail decisions from the node alone. One sample per intent is thin, but both samples failed. Hushrate should:
1. Treat any result whose `field_status` is not `ok` for every required field as invalid, and refuse to decide on it.
2. Cross-check power price against a free public ISO source before acting, and record both on the receipt.
3. Pin specific miners (`/engine/v1/ask/{minerId}`) instead of router choice; round 2 showed this fixes hashprice but not CAISO power price.

Next step: build the decision loop with hashprice from a pinned, verified miner (71083) cross-checked against mempool.space, and grid price from public CAISO OASIS data, recording any Telegraph power-price answer on the receipt as an unverified cross-check.
