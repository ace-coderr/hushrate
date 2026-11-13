# Hushrate

Hourly run-or-curtail decisions for bitcoin mining sites, with a receipt for every one.

Hushrate buys real market data from the [Telegraph](https://anjoman.ai/docs/introduction) network over x402 (Ethereum Sepolia, test USDC, $0.01 per request): a hashprice reading and the BTC/USD price every hour. It checks each purchase against a public source, records an hourly **market tape**, and lets each operator decide RUN, CURTAIL or HOLD for their own sites in the browser. Entry for Telegraph Hackathon Season II, Apps & Agents, Mission 12 (Mining and Power).

- Live: https://ace-coderr.github.io/hushrate/
- **Testnet only.** No mainnet, no real money.
- Nothing is mocked. Where an input is missing the answer is HOLD, never a guess.

## How it works

```
GitHub Actions (hourly)
  agent  ── mempool.space ──▶ 144-block hashprice, BTC/USD (public references)
         ── Telegraph (x402) ▶ hashprice (miner 71083) and BTC/USD (miner 7320), $0.01 test USDC each
         ── CAISO OASIS ─────▶ day-ahead and real-time LMP per node (public)
         └─▶ data/market/<time>.json, latest.json, history.json, ledger.json, status.json
  web    ── reads data/*.json ─▶ decisions computed in the browser with @hushrate/core
  mcp    ── reads data/*.json ─▶ hushrate_market, hushrate_decide, hushrate_receipts
```

Rules the agent follows each run:

1. Compute the public hashprice as the mean over the last 144 blocks (block reward including fees, difficulty), with BTC/USD from mempool.space.
2. Buy the hashprice from Telegraph miner 71083. Accept it only if `hashprice_sats_per_ph_day`, `block_height` and `hashrate_eh_s` are `ok`, the returned height equals the requested tip, and the value is within 1% of the public value. Otherwise use the public value and label why on the tape.
3. Buy the BTC/USD price from Telegraph miner 7320 (`CRYPTO_PRICE_USD`, `symbol=BTC`). Accept it only if the call succeeded, `price_usd` is `ok`, and it is within **0.5%** of the live mempool.space price; otherwise use the public price and label why on the tape. The accepted price is the one decisions use, so the paid data really feeds the decision. If mempool.space is unreachable there is nothing to verify against, so nothing is bought.
4. Fetch CAISO day-ahead and latest real-time (5-minute) prices for each configured node. Decisions use real-time when available, day-ahead otherwise, and the label says which.
5. Write the tape. The tape contains **market data only**; sites and decisions never leave the user's browser.

`@hushrate/core` (`packages/core`) holds the decision math, the 144-block hashprice and the tape types, and is used by the agent, the web app and the MCP server, with hand-computed tests.

## Pages

Landing, Desk (live market, 24-hour dispatch tape, per-site decisions with breakeven bars), Sites (your own sites in local storage, validated, JSON import/export), What-if (sliders for price, hashprice and efficiency), Receipts (ledger of paid requests with Sepolia explorer links, and data cost against loss avoided), Proof (re-verify in your browser: recompute 144 blocks, apply the acceptance rule, check the payment on Sepolia through a public RPC), Docs, Settings.

The default fleet is a **sample fleet of demo assumptions**, labelled as such in the app. There are no customers and no adoption numbers anywhere.

## Cost

| | |
|---|---|
| Price per Telegraph request | $0.01 (10000 units of test USDC) |
| Cap per payment | 30000 units ($0.03) |
| Paid calls per run | 2 planned (hashprice + BTC price), hard cap 3 |
| Per run | $0.02 |
| Per day (24 runs) | $0.48 |
| To 1 Dec (19 days) | $9.12 |
| Per extra site | $0.00 (one tape serves every site) |

The agent never retries after a payment settled, buys each intent at most once per UTC hour (a per-intent same-hour guard: a run that already paid for hashprice buys only the missing BTC price, and an hour that paid for both is a no-op), skips an identical request it already paid for, and pauses (writes `data/status.json`, buys nothing) if the test-USDC balance is below 0.20. A request that settles and then fails upstream is credited back to escrow by the node and shows in the ledger as billed $0.

## Failure handling

The agent exits non-zero only for real failures: a missing or wrong wallet key, unreadable config, a failed file write, or an unexpected bug (it also writes `status: error`). A failed upstream source (mempool.space, CAISO OASIS, Telegraph, the Sepolia RPC) is a **degraded run**: the run still finishes with exit code 0, the failure is listed in the tape's `degraded` field and in `data/status.json` (`state: degraded`), it shows as a warning in the Actions run, and the affected inputs are left empty so sites that need them decide HOLD. Specifics:

- mempool.space down: no hashprice or BTC price on the tape, and no Telegraph purchase (there is nothing to verify it against, so no money is spent).
- CAISO down for a node: that node has no price and decides HOLD.
- Telegraph call fails: the public hashprice is used and the tape says why.
- Sepolia RPC down: the balance cannot be proven, so no paid call is made.
- A degraded rerun never overwrites a more complete tape already recorded for the same hour (every run is still kept under `data/market/`).
- Below 0.20 test USDC the run is `paused` (exit code 0), not an error.

The Settings page shows the state, the last successful run (a degraded run counts, since the schedule is alive) and the degraded reasons.

## Limits

- **Testnet.** Sepolia test USDC only.
- **Sample fleet.** Default sites are demo assumptions. Decisions are only as good as your load, efficiency and power adder.
- **Day-ahead versus real-time.** Real-time moves every five minutes. Hushrate uses the latest published interval, not a forecast.
- **Hashprice** is a 144-block mean; single blocks vary with fees. Telegraph's miner returns one block, so its value is accepted only inside 1% of the mean.
- **One pinned miner per paid intent.** Hashprice (71083) and BTC price (7320) each come from one miner, chosen from a small probe ([docs/probe-report.md](docs/probe-report.md), round 4). If it fails the public value is used and labelled.
- **Old tapes** recorded before the BTC purchase have no `btc` block: they carry the public mempool.space price, and the app labels them that way.
- **Telegraph power price is not used.** `GRID_POWER_PRICE_GENERAL` was tested in params and query mode: miner 302 returned about 42.7 for SP15 while CAISO showed 13.27, and the CAISO-specific miners refuse the standard params. CAISO OASIS supplies power prices. Details and raw outputs are in [docs/probe-report.md](docs/probe-report.md).
- **Telemetry and SLA intents are not used.** They need a facility or service identifier the product does not have. See the probe report.
- **Three nodes.** The tape covers `TH_SP15_GEN-APND`, `TH_NP15_GEN-APND`, `TH_ZP26_GEN-APND`. Other nodes decide HOLD.
- **It reports, it does not switch hardware**, and it ignores ramp, restart and contract costs. Not financial advice.

## Navigation

One navigation bar with two modes. On the landing page it shows Product, Desk, Proof, Docs, the theme toggle and the "Open the desk" button. On every app page it becomes a single bar of the app tabs (Desk, Sites, What-if, Receipts, Proof, Docs, Settings) and the theme toggle, with nothing repeated and no call-to-action button; on a phone the tabs scroll horizontally. The focus ring appears for keyboard focus only. The footer is a grid (brand and testnet note, then Product, Verify and Project link columns, a divider, and a bottom row ending in "Built by" and the author's pill) that stacks into a single column at 375px.

## Path to mainnet (not live)

**Hushrate is NOT live on mainnet.** Network settings are in `config/networks.json`: Sepolia is active, and the mainnet entry is disabled with every value null, because Telegraph's docs publish testnet addresses only and nothing was invented. A non-testnet network refuses to run unless it is enabled, every value is supplied explicitly and `HUSHRATE_MAINNET_ENABLE=I_UNDERSTAND_THIS_USES_REAL_MONEY` is set. The checklist (Telegraph's mainnet addresses, a real USDC budget and caps, key custody, alerts, what must be re-verified) is in [docs/mainnet.md](docs/mainnet.md).

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

Other scripts: `npm run probe` (free discovery), `npx tsx agent/src/btc-probe.ts <minerId>...` (BTC price miner probe, up to 3 paid calls), `npm run retest -w agent` (power-price retest, up to 3 paid calls), `npm run ledger -w agent`, and `npm run mint -w agent` (dry run unless `--confirm`; mints Sepolia test USDC via `mint(address,uint256)`).

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

### The ticker (so hourly runs do not depend on GitHub's cron)

GitHub's `schedule` trigger is best-effort and, for this repo, has never fired. `.github/workflows/ticker.yml` is a self-chaining replacement:

1. It sleeps until the next `HH:17` UTC.
2. It dispatches the `hushrate` workflow (`gh workflow run hushrate.yml -f source=ticker`), with 3 attempts.
3. In a final step that runs `if: always()` (so a failed dispatch or a failed record run cannot break the chain) it dispatches itself again, with 3 attempts. If the wait step fails early it still waits until 10 minutes after it started before chaining, so a fault can never make it spin.

It has its own concurrency group (`hushrate-ticker`), permissions `actions: write` and `contents: read`, and a 75-minute timeout. The `schedule` trigger on the main workflow stays as a second source. A job-hour of runner time is used per hour, which is free on a public repository.

**Start it, or restart it if the chain ever stops:** GitHub, Actions tab, `ticker` in the left list, Run workflow, branch `main`. Or `gh workflow run ticker.yml`. Starting it twice does not create two chains: a second run queued behind the waiting one is replaced when the first chains its successor. The Settings page shows **Ticker alive** (last ticker-started run within 90 minutes) or tells you to restart it; the run's step summary names the exact time of the next dispatch. The chain stops only if the ticker job is killed (for example by the 75-minute timeout) or if GitHub rejects every dispatch attempt; the red `Chain the next ticker` step then carries the message to restart it.

**Two triggers in one hour cannot buy twice.** The ticker, the schedule and a manual run can all land in the same UTC hour. The agent checks first whether that hour already has a paid purchase, from two independent sources: the tape history entry for the hour, and any paid receipt file stamped inside the hour (`agent/src/guard.ts`). If so the run logs `SKIP: ... this trigger is a no-op` and exits 0 without buying or recording anything. This is separate from the per-request duplicate check, which is keyed on the block height and would not stop a second purchase after a new block. An hour whose attempt never paid (for example a degraded run) can still be retried. Runs are also serialised by the workflow's concurrency group. Check it with `npm test -w agent` (the guard tests include a two-triggers, different-block-heights scenario), or in a run log: a second trigger in the same hour prints the `SKIP` line and buys nothing.

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
- `config/networks.json` network settings (Sepolia active, mainnet disabled)
- `data/` published tape (`market/`, `latest.json`, `history.json`, `ledger.json`, `status.json`), `receipts/` (decoded payment and Telegraph receipts), `discovery/` and `probe/` (raw research output), `verification/`
- `docs/probe-report.md` what Telegraph returned, with verdicts
- `docs/mainnet.md` the path to mainnet and its checklist
