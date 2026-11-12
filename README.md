# Hushrate

Hourly run-or-curtail decisions for bitcoin mining sites, with a receipt for every one.

Hushrate buys real market data from the [Telegraph](https://anjoman.ai/docs/introduction) network over x402 (Ethereum Sepolia, test USDC, $0.01 per request), records an hourly **market tape**, and lets each operator decide RUN, CURTAIL or HOLD for their own sites in the browser. Entry for Telegraph Hackathon Season II, Apps & Agents, Mission 12 (Mining and Power).

- Live: https://ace-coderr.github.io/hushrate/
- **Testnet only.** No mainnet, no real money.
- Nothing is mocked. Where an input is missing the answer is HOLD, never a guess.

## How it works

```
GitHub Actions (hourly)
  agent  ── mempool.space ──▶ 144-block hashprice, BTC/USD (public)
         ── Telegraph (x402) ▶ hashprice from pinned miner 71083, $0.01 test USDC
         ── CAISO OASIS ─────▶ day-ahead and real-time LMP per node (public)
         └─▶ data/market/<time>.json, latest.json, history.json, ledger.json, status.json
  web    ── reads data/*.json ─▶ decisions computed in the browser with @hushrate/core
  mcp    ── reads data/*.json ─▶ hushrate_market, hushrate_decide, hushrate_receipts
```

Rules the agent follows each run:

1. Compute the public hashprice as the mean over the last 144 blocks (block reward including fees, difficulty), with BTC/USD from mempool.space.
2. Buy the same quantity from Telegraph miner 71083. Accept it only if `hashprice_sats_per_ph_day`, `block_height` and `hashrate_eh_s` are `ok`, the returned height equals the requested tip, and the value is within 1% of the public value. Otherwise use the public value and label why on the tape.
3. Fetch CAISO day-ahead and latest real-time (5-minute) prices for each configured node. Decisions use real-time when available, day-ahead otherwise, and the label says which.
4. Write the tape. The tape contains **market data only**; sites and decisions never leave the user's browser.

`@hushrate/core` (`packages/core`) holds the decision math, the 144-block hashprice and the tape types, and is used by the agent, the web app and the MCP server, with hand-computed tests.

## Pages

Landing, Desk (live market, 24-hour dispatch tape, per-site decisions with breakeven bars), Sites (your own sites in local storage, validated, JSON import/export), What-if (sliders for price, hashprice and efficiency), Receipts (ledger of paid requests with Sepolia explorer links, and data cost against loss avoided), Proof (re-verify in your browser: recompute 144 blocks, apply the acceptance rule, check the payment on Sepolia through a public RPC), Docs, Settings.

The default fleet is a **sample fleet of demo assumptions**, labelled as such in the app. There are no customers and no adoption numbers anywhere.

## Cost

| | |
|---|---|
| Price per Telegraph request | $0.01 (10000 units of test USDC) |
| Cap per payment | 30000 units ($0.03) |
| Paid calls per run | planned 1 (hashprice), hard cap 3 |
| Worst case per run | $0.03 |
| Worst case per day (24 runs) | $0.72 |
| Worst case to 1 Dec (19 days) | $13.68 |

The agent never retries after a payment settled, skips an identical request it already paid for, and pauses (writes `data/status.json`, buys nothing) if the test-USDC balance is below 0.20. A request that settles and then fails upstream is credited back to escrow by the node and shows in the ledger as billed $0.

## Limits

- **Testnet.** Sepolia test USDC only.
- **Sample fleet.** Default sites are demo assumptions. Decisions are only as good as your load, efficiency and power adder.
- **Day-ahead versus real-time.** Real-time moves every five minutes. Hushrate uses the latest published interval, not a forecast.
- **Hashprice** is a 144-block mean; single blocks vary with fees. Telegraph's miner returns one block, so its value is accepted only inside 1% of the mean.
- **Telegraph power price is not used.** `GRID_POWER_PRICE_GENERAL` was tested in params and query mode: miner 302 returned about 42.7 for SP15 while CAISO showed 13.27, and the CAISO-specific miners refuse the standard params. CAISO OASIS supplies power prices. Details and raw outputs are in [docs/probe-report.md](docs/probe-report.md).
- **Telemetry and SLA intents are not used.** They need a facility or service identifier the product does not have. See the probe report.
- **Three nodes.** The tape covers `TH_SP15_GEN-APND`, `TH_NP15_GEN-APND`, `TH_ZP26_GEN-APND`. Other nodes decide HOLD.
- **It reports, it does not switch hardware**, and it ignores ramp, restart and contract costs. Not financial advice.

## Run it yourself

Node 20 or newer.

```bash
git clone https://github.com/ace-coderr/hushrate.git
cd hushrate
npm install
cp .env.example .env           # set EVM_PRIVATE_KEY to a Sepolia TEST wallet
npm run wallet                 # test ETH and test USDC balances (read-only)
npm run agent -- --no-pay --dry   # free: print a tape from public sources only
npm run agent                  # buys one hashprice reading and writes data/
npm run dev -w web             # local web app (serves ../data at /data)
```

Other scripts: `npm run probe` (free discovery), `npm run retest -w agent` (power-price retest, up to 3 paid calls), `npm run ledger -w agent`, and `npm run mint -w agent` (dry run unless `--confirm`; mints Sepolia test USDC via `mint(address,uint256)`).

## Reproduce the build and checks

```bash
npm test               # core and MCP tests (hand-computed)
npm run typecheck
npm run build -w web   # static site in web/dist (VITE_BASE=/hushrate/ for Pages)
npm run build -w packages/mcp
```

To reproduce the proof by hand, open the Proof page, or recompute the mean of `reward * 1e15 * 86400 / (difficulty * 2^32)` over the 144 blocks ending at `block_height` in `data/latest.json`, and look up any `tx_hash` from `data/ledger.json` on Sepolia.

## Hourly workflow

`.github/workflows/hushrate.yml` runs every hour at :17 UTC (`17 * * * *`) and on demand, one run at a time. It runs the tests, records the tape with `EVM_PRIVATE_KEY` from a repository secret, commits `data/` with the noreply author, builds the web app and deploys to GitHub Pages. A push to `main` only rebuilds and deploys; it does not buy data.

**Do not edit anything under `data/` by hand.** `data/market/`, `latest.json`, `history.json`, `ledger.json`, `status.json` and `receipts/` are generated by the workflow, and the workflow's copy always wins: its commit step (`scripts/commit-data.sh`) saves the run's files, hard-resets to `origin/main`, copies them back over, commits and pushes (3 attempts, each re-fetching), and never rebases or merges generated data. A hand edit to those files is overwritten on the next run, and pushing one while a run is in progress is exactly what once broke the commit step. Research output in `data/discovery/`, `data/probe/` and `data/verification/` is not touched by the workflow.

Setup once: add the secret `EVM_PRIVATE_KEY` (Settings, Secrets and variables, Actions) and set Settings, Pages, Source to GitHub Actions.

## MCP server

Reads the published JSON, so it needs no key and no wallet.

```bash
npm install
npm run build -w packages/mcp
```

Add to your MCP client (for example `claude_desktop_config.json`) with the real absolute path:

```json
{
  "mcpServers": {
    "hushrate": { "command": "node", "args": ["/absolute/path/to/hushrate/packages/mcp/dist/index.js"] }
  }
}
```

Tools: `hushrate_market` (latest tape), `hushrate_decide` (site parameters in, decision and breakeven out), `hushrate_receipts` (ledger of paid requests). Set `HUSHRATE_DATA_URL` to read a different copy of `data/`.

## Repository layout

- `agent/` Node + TypeScript: agent, CAISO client, x402 client with spend guards, ledger, probe, retest, mint
- `packages/core/` shared decision math, hashprice, tape types
- `packages/mcp/` MCP server
- `web/` React + Vite app
- `config/agent.json` nodes, pinned miners, tolerances
- `data/` published tape (`market/`, `latest.json`, `history.json`, `ledger.json`, `status.json`), `receipts/` (decoded payment and Telegraph receipts), `discovery/` and `probe/` (raw research output), `verification/`
- `docs/probe-report.md` what Telegraph returned, with verdicts
