# Payment asset change (2026-11-17)

On **2026-11-17**, starting with the 07:17 UTC run, every paid Telegraph call from Hushrate failed. Telegraph's x402 challenge had started asking for a different token on Ethereum Sepolia, and Hushrate's spend controls (which allow one specific asset) refused it. **No payment was made or lost**: the client refused before signing, and the failure message was generic. This note records what changed, how it was checked, and what Hushrate does now. Raw data: `data/probe/payment-asset-2026-11-17T14-10-01-455Z.json` (regenerate with `npx tsx scripts/payment-asset.mts`, which fetches the free 402 challenges and reads the token on chain; it pays nothing).

## What the challenge asks for now

Free `POST` requests without a payment header, at block height 976281, 2026-11-17 14:10 UTC. Every endpoint returned HTTP 402 with the same terms on Ethereum Sepolia:

| Endpoint | Intent | Scheme | Network | Asset | Amount | payTo |
|---|---|---|---|---|---|---|
| miner 71083 | `MINING_HASHPRICE_VERIFY_GENERAL` | exact | eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 10000 | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` |
| miner 1900999013 | `MINING_HASHPRICE_VERIFY_GENERAL` | exact | eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 10000 | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` |
| miner 7320 | `CRYPTO_PRICE_USD` | exact | eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 10000 | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` |
| router (no miner id) | `CRYPTO_PRICE_USD` | exact | eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 10000 | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` |

Each challenge lists the same other options: `exact` on Base Sepolia (eip155:84532, asset `0x036CbD53842c5426634e7929541eC2318f3dCF7e`), `exact` on Solana devnet, and an `escrow` scheme (charged to a Telegraph escrow balance, funded with `LedgerFacet.depositUSDC`, no asset field). Hushrate uses none of those.

The asset Hushrate used until the change was `0xcc194e1a843B658526D0D5C431f670028582Ae17`, and the payee it paid before was a different address. Both the asset and the payee changed.

## Checked on chain (public Sepolia RPC, 2026-11-17)

| Token | Has code | Symbol | Name | Decimals | Wallet balance |
|---|---|---|---|---|---|
| `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (asked for now) | yes | USDC | USDC | **6** | 0 at 14:10 UTC, then 20 after the funding transaction below |
| `0xcc194e1a843B658526D0D5C431f670028582Ae17` (used before) | yes | USDC | USD Coin | 6 | 13.78 (no longer accepted) |

This is Circle's test USDC on Ethereum Sepolia, so it is funded from Circle's faucet, not minted by Hushrate. The wallet was funded with 20 of it at 2026-11-17 14:16 UTC, block 12154933, transaction `0xf5ae7ab206897bd3f455096ed65221b095e9d4368e097d9330b6449103e68b82`. The 13.78 of the previous token stays in the wallet and cannot be used with the current challenge.

## What it cost

- **Data:** hourly tapes for 07:00 to 13:00 UTC on 2026-11-17 (7 tapes) bought nothing and carry the labelled public values (`data/history.json`: `paid_calls` is 0 for each). The 05:00 and 06:00 tapes were bought normally.
- **Money:** none was spent during the incident. Nothing was signed.
- **Why it was not louder:** the failure reason named neither the asset nor the network the miner asked for, and nothing marked a run of public-only hours. Both are fixed below.

## What Hushrate does now

1. **Pinned terms.** `config/networks.json` pins the asset, the network and the payee. The payment client allows exactly that asset (cap 30000 units, 3 cents, per payment) and a policy also requires the pinned network, scheme and payee. The previous asset is not on the allow list. `allowedAssets: true` and `spendControls: false` are never used. Telegraph's documentation advises reading `payTo` from each challenge and never hard-coding it; Hushrate pins it anyway so a compromised or mistaken node cannot redirect funds. The cost is that a legitimate payee change is refused until the config line is updated (the refusal says exactly which payee was asked for).
2. **The asset is recorded.** Every new tape (`payment`), receipt and ledger row carries the asset, network and payee it was allowed to pay with. Tapes, receipts and ledger rows written before today have no such field and are read as the previous asset (`0xcc194e…Ae17`).
3. **Funding is checked first.** Before any call the agent reads the wallet balance of the pinned token and compares it with the cost of the run (2 requests, 20000 units). If it cannot pay it makes **no miner call**, records the reason `unfunded: needs USDC 0x1c7D…7238 on Ethereum Sepolia` as a degraded event, and uses the public values, labelled. A low balance (under 0.20) is a note, not a stop.
4. **Refusals are specific.** If the payment client refuses a miner's terms, the degraded reason names the asset and network the miner asked for and the ones that are pinned, and the rest of the run makes no further calls to that node (they would all be refused the same way).
5. **A banner.** The Settings and Desk pages show **Paid data paused** when the two most recent hourly tapes bought nothing, with how many of the last 24 hours were public-only and what to fund.
6. **Checks follow the recorded asset.** The Proof page's payment check and the Receipts page take the asset from the ledger row, so requests paid in either token verify; Receipts links the token for each row.

## How to fund the wallet

Circle's faucet (https://faucet.circle.com/): choose network **Ethereum Sepolia**, token **USDC**, and paste the wallet address from `config/networks.json`. The token it sends is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. Gas (Sepolia ETH) is a separate faucet; the wallet's Sepolia ETH balance has not changed across the 200+ x402 payments made so far, so payments evidently do not spend the wallet's gas.
