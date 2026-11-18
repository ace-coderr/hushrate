# The escrow rail

Written 2026-11-18. Source: https://anjoman.ai/docs/using/escrow-inference (read in full), checked against the live node with free calls only (`scripts/escrow-probe.mts`, saved as `data/probe/escrow-2026-11-18T20-20-41-769Z.json`).

## Why

Since 2026-11-17 20:17 UTC every paid call Hushrate signed failed at the node's settlement step: HTTP 402, "settlement failed: settle request failed: Post https://facilitator.x402.rs/settle: context deadline exceeded". Nothing moved and the tapes were public-only and labelled. Telegraph confirmed the integration was still valid and pointed to its escrow rail: same `/engine/v1/ask` endpoint, funded once, no facilitator and no per-request on-chain settlement.

## Facts confirmed before any money moved

| Fact | Live result (2026-11-18 20:20 UTC) |
|---|---|
| Miners 71083 and 7320 return a 402 with an `escrow` entry | Yes, for both (header `PAYMENT-REQUIRED`) |
| Network | `eip155:11155111` |
| payTo | `0x72a70e949362670bf8bcead24efc5b8f950aa08b` (the Diamond, lower-case in the escrow entry) |
| Amount | `10000` uUSDC (`$0.01`), in the entry's `amount` and in the message's `Amount:` line |
| Template | `Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a7…\nNetwork: eip155:11155111\nAmount: 10000 uUSDC\nResource: /v1/ask/<miner>\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}` |
| Resource | The path inside the engine, per miner (`/v1/ask/71083`, `/v1/ask/7320`) |
| Escrow token and Diamond | `0xcc194e1a843B658526D0D5C431f670028582Ae17` and `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` (the exact entry asks for the same token to the same address) |
| `GET /v1/ledger/account/<address>` | 200; before funding `deposited`, `balance`, `available` were all `0` |
| The Diamond serves `depositUSDC(uint256)` | Yes (Diamond loupe: facet `0xF4A97a1BC6F213fa30a79E17eD5336A9762399a8`) |
| CORS on the billing and ledger endpoints | `Access-Control-Allow-Origin: *`, so the Proof page can read them |

**Where the live behaviour differed from the brief.** The docs page shows the template as `Pay To: 0x72a70e94…` (abbreviated); the live template carries the full lower-case address. Hushrate requires the full pinned address in the message. Nothing else differed.

## Funding

`scripts/fund-escrow.ts` (dry run by default, `--execute` to send). Hard checks: chain 11155111, token exactly `0xcc19…`, spender and target exactly the Diamond, amount at most 8 USDC, the Diamond must serve `depositUSDC` (Diamond loupe) and the call is simulated before it is sent. The key comes from the local `.env` and is never printed.

| | |
|---|---|
| Time | 2026-11-18 20:23 UTC |
| Amount | 8.00 USDC (8000000 base units) |
| Approve | `0x049cce737e49ac3ca9b87f8b0551656a14c94cf6cc73e4ab7f163c09387c4496` (block 12163765) |
| Deposit | `0xfe542fb2dc6088d2516108c9410c5142ca4afdbf141bef4503a5012c69969a4d` (block 12163767) |
| Ledger after | `deposited` 8000000, `balance` 8000000, `available` 8000000 |

Recorded in `data/deposits.json` (public: hashes and amounts only). 8 USDC covers 800 calls, about 400 runs or 16 days at two calls per hour.

## What a served call looks like

- Request: `POST /engine/v1/ask/<miner>` with header `X-PAYMENT` (not `PAYMENT-SIGNATURE`): base64 of `{x402Version:2, scheme:"escrow", network:"eip155:11155111", payload:{signature, authorization:{from, to, value, validAfter, validBefore, nonce}}}`.
- Response header `X-PAYMENT-RESPONSE`: `receipt_hash`, `rail: "escrow"`, `payer`, `miner`, `intent`, `amount_uusdc`, `epoch_id`, `settlement: "epoch"`, `chain: "telegraph"`. No `tx_hash`, by design.
- Billing proof, later: `GET /v1/blocks/{epochId}/deliveries/{receiptHash}` (404 `no block recorded for this epoch` until the epoch's block exists, up to about an hour on the testnet).

## How Hushrate was checked before the first live escrow call

Against a local stub node (nothing left the machine): the stub rebuilt the message from the template and verified the EIP-191 signature, the exact value, the Diamond as payee, the 120-second window limit, the lower-case wallet and nonce replay. Passed: funded escrow served with a matching receipt and no tx hash; an identical request skipped; a wrong payee refused with nothing sent; an insufficient escrow balance paid nothing and named the shortfall; an unreadable balance paid nothing and did not fall back to settlement; the 3-call cap counted escrow attempts. The pure rules are also unit-tested (`packages/core/src/escrow.test.ts`, `agent/src/escrow.test.ts`).
