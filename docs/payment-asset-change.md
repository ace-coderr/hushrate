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

Because Telegraph is mid-deployment and the asset may change again, Hushrate does not pin one asset. It pays from an **explicit allow-list of two Sepolia assets**, each with its own exact payee, and pays whichever of the two the node's 402 asks for:

| Asset | Payee | Role |
|---|---|---|
| `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (Circle USDC, 6 decimals) | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` | current, asked for since 2026-11-17 |
| `0xcc194e1a843B658526D0D5C431f670028582Ae17` (previous test USDC, 6 decimals) | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` (see the update below; until 2026-11-17 the payee for this asset was `0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b`, read from the Transfer logs of settled payments) | previous, asked for until 07:00 UTC and again from about 16:00 UTC on 2026-11-17 |

1. **Enforced by the payment client.** Spend controls allow exactly those two assets, each capped at 30000 units (3 cents) per payment, and a policy requires the exact (network, asset, payee) triple, so a known asset to a different payee, another network, or the escrow scheme is refused. `allowedAssets: true` and `spendControls: false` are never used; the run cap stays 3 paid calls. Telegraph's documentation advises reading `payTo` from each challenge and never hard-coding it; Hushrate pins it per asset anyway so a compromised or mistaken node cannot redirect funds. The cost is that a legitimate new payee is refused until the config is updated (the refusal says exactly what was asked for).
2. **Checked before any miner is called.** The agent fetches the node's 402 challenge for free and assesses it: **refused** (asset or payee not on the allow-list: the degraded reason names the asset and network asked for, and no miner is called), **unfunded** (allowed, but the wallet's balance of *that* asset is below the cost of the run, 20000 units: recorded as `unfunded for USDC 0x…` with labelled public values, and no miner is called), or **ok**. The other asset's balance is irrelevant, because the node, not Hushrate, picks the asset. A challenge or balance that cannot be read means no payment.
3. **Both balances are shown.** The agent reads the wallet balance of each allowed asset every run; `data/status.json` and the Settings page list them and mark the one the node asked for.
4. **The asset is recorded.** Every new tape (`payment`: the asset in use, what the node requested, the allow-list), receipt and ledger row carries the asset, network and payee. Tapes, receipts and ledger rows written before today have no such field and are read as the previous asset (`0xcc194e…Ae17`).
5. **A banner.** Settings and Desk show **Paid data paused** when the two most recent hourly tapes bought nothing, with how many of the last 24 hours were public-only and which asset the wallet is unfunded for.
6. **Checks follow the recorded asset.** The Proof page's payment check and the Receipts page take the asset from the ledger row, so requests paid in either token verify; Receipts links the token for each row.

## First funded run (2026-11-17 15:17 UTC): verified, not settled

The wallet was funded with 20 Circle USDC at 14:16 UTC and the allow-list code went live at 14:38 UTC. The 15:17 UTC run assessed the node's terms as allowed and funded, then signed and sent both payments. **The node answered HTTP 402 for both, with the reason "the payment was verified but could not be settled": `settle request failed: Post "https://facilitator.x402.rs/settle": context deadline exceeded`.** So the asset, payee and signature were accepted; Telegraph's facilitator timed out while settling. Evidence that nothing moved: the receipts record `success: false` with no transaction, no transfer left the wallet (checked on chain), and the wallet still held 20 of the new token. The signed authorizations are valid for 60 seconds, so they cannot settle later. The facilitator answered normally a few minutes afterwards (`/health` and `/supported` returned 200, listing `exact` on eip155:11155111).

That run exposed three recording defects, now fixed: a signed-but-unsettled payment was counted as a purchase (so history and the "Paid data paused" banner treated the hour as paid); the receipt did not record the asset because the post-payment 402 overwrote the captured challenge; and the degraded reason said only "HTTP 402". Accounting, history and the banner now count settled payments only, the receipt records the asset from the initial challenge, and the reason carries the node's own explanation. The 15:00 UTC history entry was recomputed from its recorded tape with the corrected logic. A run that finds an hour unsettled can be retried by the next trigger in that hour; the agent does not retry within a run, because a second signed authorization while the first is still valid could settle twice.

## Second change (about 16:00 to 19:00 UTC): the previous asset again, to the new payee

The 16:17, 17:17 and 18:17 UTC runs recorded no purchase and the refusal reason named what the node asked for: **the previous asset (`0xcc19…Ae17`) paid to the new payee (`0x72a7…aa08b`)**. The free challenge at 19:09 UTC confirmed it for all four endpoints (miners 71083, 1900999013, 7320 and the router). Hushrate refused it, as designed, because the allow-list paired that asset with its earlier payee. No money moved and the wallet still held 20 of the Circle token and 13.78 of the previous token.

Decision: both allowed assets are now pinned to the single payee the node publishes (`0x72a7…aa08b`, which is also the payee of its escrow option), and the earlier payee (`0x3624…b99b`) is no longer allowed. That keeps the exact-payee check and leaves one trusted payee instead of two. If the node changes payee again, the refusal will name it and the fix is one line in `config/networks.json`. The wallet holds 13.78 of the asset now being asked for, which is enough for 689 runs.

## How to fund the wallet

Circle's faucet (https://faucet.circle.com/): choose network **Ethereum Sepolia**, token **USDC**, and paste the wallet address from `config/networks.json`. The token it sends is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. The previous token can still be minted with `npm run mint -w agent -- --confirm`, but it is only useful if the node asks for it again. Gas (Sepolia ETH) is a separate faucet; the wallet's Sepolia ETH balance has not changed across the 200+ x402 payments made so far, so payments evidently do not spend the wallet's gas.
