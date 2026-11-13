# Path to mainnet

**Hushrate is NOT live on mainnet.** Every payment today is Ethereum Sepolia test USDC at $0.01 per request. Telegraph's published documentation lists testnet addresses only, so this repository contains **no mainnet addresses**, and none were invented.

## What exists in code

- `config/networks.json` holds the network settings. `active` is `sepolia`.
- A `mainnet` entry exists but is **disabled** (`enabled: false`) and every value in it is `null` on purpose (chain id, CAIP-2 id, RPC, node URL, settlement asset address, expected wallet, explorer, per-payment cap, per-run call cap, minimum balance).
- `agent/src/network.ts` refuses to run any non-testnet network unless **all** of these hold:
  1. it is switched on in the file (`enabled: true`);
  2. every value above is supplied explicitly (nothing is defaulted, addresses must be valid, `caip2` must match `chain_id`, the per-payment cap must be a positive integer);
  3. the environment carries `HUSHRATE_MAINNET_ENABLE=I_UNDERSTAND_THIS_USES_REAL_MONEY`.
- The refusal is a real failure: the agent exits non-zero and writes `status: error`.
- `agent/src/mint.ts` refuses to run on any non-testnet network.
- `agent/src/network.test.ts` covers each refusal. The tests use obviously fake fixture values, not real ones.
- The web app (Receipts, Proof) still points at Sepolia and its explorer; it would need the same change.

## Checklist before anyone flips it

1. **Addresses from Telegraph.** The mainnet node URL, the settlement asset address, the payee and the chain's CAIP-2 id, taken from Telegraph's own documentation or team, never from this repository or a guess.
2. **A real USDC budget and caps.** Pick a small total budget. Set `max_amount_per_payment`, `max_paid_calls_per_run` and a `min_balance_units` floor in the config. Recompute the cost table at real prices (today: 2 paid calls per run).
3. **Key custody.** A dedicated low-balance hot wallet used by this agent only. A repository secret is acceptable for a testnet key, not long term for a funded one: move to a secrets manager, a short-lived signing service, or a smart wallet with a spending limit.
4. **Alerts.** A notification when the hourly chain stalls (the Settings page already shows the ticker and the last successful run) and when the balance nears the floor, so a stalled agent never silently serves stale data.
5. **Re-verify everything.**
   - Re-run the miner probes on mainnet: miner ids and scores differ per network, and the pinned miners (`config/agent.json`) were chosen on testnet.
   - Re-check the acceptance tolerances (hashprice 1%, BTC price 0.5%).
   - Re-test the same-hour guard and the duplicate-payment key with real settlement.
   - Confirm what happens to a payment whose request fails upstream (on the testnet node it is credited to escrow).
   - Re-read Telegraph's terms for production use.
6. **Scope the claims.** Until all of the above is done and checked, keep the site and README labelled testnet only.
