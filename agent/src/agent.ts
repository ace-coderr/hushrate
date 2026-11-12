// Hushrate market agent: one run records one hourly MARKET tape. No site data, no decisions.
//   tsx src/agent.ts            buy hashprice from Telegraph (test USDC), write the tape
//   tsx src/agent.ts --no-pay   public sources only, spends nothing
//   tsx src/agent.ts --dry      print the tape, write nothing
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchTipHeight, fetchBtcUsd, fetchBlocks, windowHashprice, blockHashprice, toHistoryEntry,
  type MarketTape, type PowerPrice, type TelegraphCall, type HistoryEntry,
} from "@hushrate/core";
import { balances } from "./wallet.js";
import { dayAhead, realTime } from "./caiso.js";
import { writeLedger } from "./ledger.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const cfg = JSON.parse(readFileSync(`${ROOT}config/agent.json`, "utf8"));
const noPay = process.argv.includes("--no-pay");
const dry = process.argv.includes("--dry");
const MIN_USDC_RAW = 200_000n; // stop below 0.20 test USDC
const HISTORY_MAX = 500;

const write = (rel: string, data: unknown) => {
  if (dry) return;
  const p = `${ROOT}${rel}`;
  mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
};
const status = (state: "ok" | "paused" | "error", extra: Record<string, unknown>) =>
  write("data/status.json", { state, updated_at: new Date().toISOString(), ...extra });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- cost table ----------------------------------------------------------------------------
const MAX_CALLS = 3, PRICE = 0.01, HOURS = 24, DAYS = 19;
console.log("Cost table (Ethereum Sepolia, test USDC, no real money)");
console.log(`  price per call           $${PRICE.toFixed(2)} (10000 units, cap per payment 30000)`);
console.log(`  paid calls per run (max) ${MAX_CALLS}  -> $${(MAX_CALLS * PRICE).toFixed(2)} worst case per run`);
console.log(`  per day (24 runs)        $${(MAX_CALLS * PRICE * HOURS).toFixed(2)}`);
console.log(`  to 1 Dec (${DAYS} days)       $${(MAX_CALLS * PRICE * HOURS * DAYS).toFixed(2)}`);
console.log(`  planned this run         ${noPay ? 0 : 1 + (cfg.telegraph.power_miner ? Math.min(cfg.telegraph.power_nodes_max, cfg.nodes.length) : 0)} call(s)`);

// ---- balance guard -------------------------------------------------------------------------
const bal = await balances();
console.log(`wallet: ${bal.eth} ETH, ${bal.usdc} USDC`);
if (!noPay && BigInt(bal.usdcRaw) < MIN_USDC_RAW) {
  status("paused", { reason: `test-USDC balance ${bal.usdc} is below 0.20; no paid calls made`, usdc_balance: bal.usdc });
  console.error("PAUSED: balance below 0.20 test USDC. status written, nothing bought.");
  process.exit(0);
}

const now = new Date();
const hour = new Date(now); hour.setUTCMinutes(0, 0, 0);
const hourIso = hour.toISOString().replace(".000Z", "Z");
const notes: string[] = [];

// ---- public market inputs ------------------------------------------------------------------
let tip: number, btc: number, rows: Awaited<ReturnType<typeof fetchBlocks>>;
try {
  tip = await fetchTipHeight();
  btc = await fetchBtcUsd();
  rows = await fetchBlocks(tip, 144);
} catch (e) {
  status("error", { reason: `public market inputs unavailable: ${e}`, usdc_balance: bal.usdc });
  console.error(`ERROR: public market inputs unavailable (${e}); nothing recorded.`);
  process.exit(1);
}
const w = { tip, ...windowHashprice(rows) };
const singleAtTip = blockHashprice(rows[0].reward_sats, rows[0].difficulty);

// ---- Telegraph calls -----------------------------------------------------------------------
let spendCalls = 0, spendUsd = 0;

function callFrom(intent: string, minerId: string, file: string | undefined, paidNow: boolean): TelegraphCall {
  return { intent, requested_miner: minerId, http_status: null, paid: paidNow, cost_usd: null, value: null, accepted: false, receipt_file: file ?? null };
}

async function paid(label: string, minerId: string, intent: string, params: Record<string, unknown>, valueKey: string): Promise<TelegraphCall> {
  const x = await import("./x402.js");
  let out;
  try { out = await x.run({ label, minerId, intent, params }); }
  catch (e) { return { ...callFrom(intent, minerId, undefined, false), reject_reason: `call failed: ${e}` }; }
  const rec = x.readReceipt(out.receipt_file!);
  const b = rec.response ?? {};
  const spentNow = !out.skipped && rec.paid;
  // A settled payment that then failed upstream is credited back to escrow; the call is recorded but not billed.
  const billed = rec.http_status === 200 ? (b.cost_usd ?? null) : 0;
  if (spentNow) { spendCalls++; spendUsd += billed ?? PRICE; }
  const tr = rec.telegraph_receipt ?? {};
  return {
    intent, requested_miner: minerId, miner_id: b.miner_id ?? null, miner_name: b.miner_name ?? null,
    http_status: rec.http_status, paid: !!rec.paid, cost_usd: billed, field_status: b.field_status ?? null,
    value: typeof b.result?.[valueKey] === "number" ? b.result[valueKey] : null,
    returned_height: b.result?.block_height ?? null, signal_hash: b.signal_hash ?? null,
    receipt_hash: tr.receipt_hash ?? null, tx_hash: tr.tx_hash ?? rec.payment_response?.transaction ?? null,
    receipt_file: out.receipt_file, accepted: false,
  };
}

// Hashprice
let hashCall: TelegraphCall | null = null;
let hashValue = w.hashprice_sats_per_ph_day;
let hashSource: "telegraph" | "public" = "public";
let hashLabel = "public: mempool.space, mean of the last 144 blocks (reward incl. fees, difficulty)";
if (!noPay) {
  hashCall = await paid(`hashprice-${tip}`, cfg.telegraph.hashprice_miner, "MINING_HASHPRICE_VERIFY_GENERAL", { block_height: tip }, "hashprice_sats_per_ph_day");
  const fs = hashCall.field_status ?? {};
  // Fields this agent relies on must be ok. hashprice_usd_per_ph_day is not required: USD is computed locally from the public BTC price.
  const needed = ["hashprice_sats_per_ph_day", "block_height", "hashrate_eh_s"];
  const bad = needed.filter((k) => fs[k] !== "ok");
  const rel = hashCall.value !== null ? Math.abs(hashCall.value - w.hashprice_sats_per_ph_day) / w.hashprice_sats_per_ph_day : null;
  let reason: string | null = null;
  if (hashCall.reject_reason) reason = hashCall.reject_reason;
  else if (hashCall.http_status !== 200) reason = `HTTP ${hashCall.http_status}`;
  else if (bad.length) reason = `field not ok: ${bad.join(", ")}`;
  else if (hashCall.returned_height !== tip) reason = `block height ${hashCall.returned_height} != requested ${tip}`;
  else if (rel === null) reason = "no value";
  else if (rel > cfg.tolerance.hashprice_rel) reason = `differs ${(rel * 100).toFixed(2)}% from the public 144-block value (limit ${cfg.tolerance.hashprice_rel * 100}%)`;
  if (reason === null) {
    hashCall.accepted = true; hashValue = hashCall.value as number; hashSource = "telegraph";
    hashLabel = `Telegraph miner ${hashCall.miner_id}, within ${cfg.tolerance.hashprice_rel * 100}% of the public 144-block value`;
  } else {
    hashCall.reject_reason = reason;
    hashLabel += `; Telegraph value not used: ${reason}`;
  }
}

// Power: public CAISO prices, optional Telegraph power miner when one has been proven in docs/probe-report.md
const power: PowerPrice[] = [];
let tgPowerLeft = !noPay && cfg.telegraph.power_miner ? cfg.telegraph.power_nodes_max : 0;
for (const node of cfg.nodes as string[]) {
  const p: PowerPrice = { node, day_ahead_usd_per_mwh: null, day_ahead_interval: null, real_time_usd_per_mwh: null, real_time_interval: null, telegraph: null, errors: [] };
  try { const d = await dayAhead(node, hour); p.day_ahead_usd_per_mwh = d.usd_per_mwh; p.day_ahead_interval = d.interval_start; } catch (e) { p.errors.push(String(e)); }
  await sleep(5500); // CAISO OASIS asks for at least 5 seconds between requests
  try { const r = await realTime(node, now); p.real_time_usd_per_mwh = r.usd_per_mwh; p.real_time_interval = r.interval_start; } catch (e) { p.errors.push(String(e)); }
  await sleep(5500);
  if (tgPowerLeft > 0) {
    tgPowerLeft--;
    const c = await paid(`power-${node}-${hourIso}`, cfg.telegraph.power_miner, "GRID_POWER_PRICE_GENERAL", { node_or_zone: node, interval_start: hourIso }, "lmp_usd_per_mwh");
    const ref = p.day_ahead_usd_per_mwh;
    const diff = c.value !== null && ref !== null ? Math.abs(c.value - ref) : null;
    const tol = ref !== null ? Math.max(cfg.tolerance.power_abs_usd, Math.abs(ref) * cfg.tolerance.power_rel) : null;
    if (c.http_status !== 200) c.reject_reason = c.reject_reason ?? `HTTP ${c.http_status}`;
    else if (c.field_status?.lmp_usd_per_mwh !== "ok") c.reject_reason = "lmp field not ok";
    else if (diff === null || tol === null) c.reject_reason = "no CAISO reference to check against";
    else if (diff > tol) c.reject_reason = `differs $${diff.toFixed(2)} from CAISO day-ahead (limit $${tol.toFixed(2)})`;
    else c.accepted = true;
    p.telegraph = c;
  }
  power.push(p);
}

// ---- tape ----------------------------------------------------------------------------------
// Accounting follows the calls the tape references, so a second run in the same hour (which skips an
// identical purchase) still reports what that hour cost.
const tapeCalls = [hashCall, ...power.map((p) => p.telegraph)].filter((c): c is TelegraphCall => !!c && c.paid);
const tapeSpend = { paid_calls: tapeCalls.length, cost_usd: Number(tapeCalls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(2)) };
const tape: MarketTape = {
  schema: 1, interval_start: hourIso, recorded_at: now.toISOString(), block_height: tip, btc_usd: btc,
  hashprice: { value_sats_per_ph_day: hashValue, source: hashSource, label: hashLabel, public_144: w, telegraph: hashCall, public_at_telegraph_height: singleAtTip },
  power, spend: tapeSpend,
  wallet_usdc_after: null, notes,
};
tape.wallet_usdc_after = (await balances()).usdc;
if (noPay) notes.push("run with --no-pay: no Telegraph data bought");
for (const p of power) if (p.real_time_usd_per_mwh === null && p.day_ahead_usd_per_mwh === null) notes.push(`${p.node}: no power price available`);

const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
write(`data/market/${stamp}.json`, tape);
write("data/latest.json", tape);
const hp = `${ROOT}data/history.json`;
let hist: HistoryEntry[] = [];
if (existsSync(hp)) { try { hist = JSON.parse(readFileSync(hp, "utf8")); } catch { notes.push("history.json unreadable; restarted"); } }
hist = hist.filter((h) => h.interval_start !== hourIso);
hist.push(toHistoryEntry(tape));
write("data/history.json", hist.slice(-HISTORY_MAX));
if (!dry) console.log(`ledger rows: ${writeLedger()}`);
status("ok", { usdc_balance: tape.wallet_usdc_after, last_tape: `data/market/${stamp}.json`, paid_calls_last_run: spendCalls, cost_usd_last_run: Number(spendUsd.toFixed(2)), hashprice_source: hashSource });

console.log(`\ninterval ${hourIso} | block ${tip} | BTC $${btc}`);
console.log(`hashprice ${hashValue.toFixed(1)} sats/PH/day (${hashSource}); single block at tip ${singleAtTip.toFixed(1)}, 144-block range ${w.min_block.toFixed(0)}..${w.max_block.toFixed(0)}`);
console.log(`  ${hashLabel}`);
for (const p of power) console.log(`${p.node}: real-time ${p.real_time_usd_per_mwh ?? "n/a"}  day-ahead ${p.day_ahead_usd_per_mwh ?? "n/a"} $/MWh${p.errors.length ? "  (" + p.errors.join("; ") + ")" : ""}`);
console.log(`spent this run: ${spendCalls} call(s), $${spendUsd.toFixed(2)}; tape accounts for ${tapeSpend.paid_calls} paid call(s), $${tapeSpend.cost_usd.toFixed(2)}; wallet ${tape.wallet_usdc_after} USDC${dry ? " [dry run: nothing written]" : ""}`);
