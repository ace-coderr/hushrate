// Hushrate market agent: one run records one hourly MARKET tape. No site data, no decisions.
//   tsx src/agent.ts            buy hashprice from Telegraph (test USDC), write the tape
//   tsx src/agent.ts --no-pay   public sources only, spends nothing
//   tsx src/agent.ts --dry      print the tape, write nothing
//
// Exit codes: 0 for a clean run, a degraded run (an upstream source failed; recorded in the tape and in
// data/status.json) and a paused run (balance below 0.20). Non-zero only for real failures: an unusable key,
// unreadable config, a failed write, or an unexpected bug.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchTipHeight, fetchBtcUsd, fetchBlocks, windowHashprice, blockHashprice, toHistoryEntry, selectPower, tapeScore,
  type MarketTape, type PowerPrice, type TelegraphCall, type HistoryEntry,
} from "@hushrate/core";
import { balances } from "./wallet.js";
import { dayAhead, realTime } from "./caiso.js";
import { writeLedger } from "./ledger.js";
import { paidThisHourFromDisk } from "./guard.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const noPay = process.argv.includes("--no-pay");
const dry = process.argv.includes("--dry");
const MIN_USDC_RAW = 200_000n; // stop below 0.20 test USDC
const HISTORY_MAX = 500;
const MAX_CALLS = 3, PRICE = 0.01, HOURS = 24, DAYS = 19;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A key or wallet problem is a real failure, never a degraded run. */
const isFatal = (e: unknown) => /EVM_PRIVATE_KEY|Configured key controls/.test(msg(e));

const write = (rel: string, data: unknown) => {
  if (dry) return;
  const p = `${ROOT}${rel}`;
  mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
};
const readJson = <T>(rel: string): T | null => {
  try { return JSON.parse(readFileSync(`${ROOT}${rel}`, "utf8")) as T; } catch { return null; }
};

type State = "ok" | "degraded" | "paused" | "error";
// last_success_at moves forward on ok and degraded runs (the schedule is alive); paused and error leave it alone.
const status = (state: State, extra: Record<string, unknown>) => {
  const at = new Date().toISOString();
  const alive = state === "ok" || state === "degraded";
  write("data/status.json", {
    state, updated_at: at,
    last_success_at: alive ? at : readJson<{ last_success_at?: string }>("data/status.json")?.last_success_at ?? null,
    ...extra,
  });
};

/** HUSHRATE_TRIGGER is set by the workflow: ticker, schedule, manual, push... Unset for local runs, which are not recorded. */
function noteTrigger(now: Date): void {
  const t = process.env.HUSHRATE_TRIGGER;
  if (!t) return;
  const prev = readJson<Record<string, string | null>>("data/ticker.json") ?? {};
  const at = now.toISOString();
  write("data/ticker.json", {
    ...prev,
    last_trigger: t,
    last_trigger_at: at,
    ...(t === "ticker" ? { last_ticker_at: at } : {}),
    ...(t === "schedule" ? { last_schedule_at: at } : {}),
    ...(t === "manual" || t === "workflow_dispatch" ? { last_manual_at: at } : {}),
  });
}

const warn = (m: string) => { console.warn(`DEGRADED: ${m}`); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Hushrate degraded run::${m}`); };

async function main(): Promise<void> {
  const cfg = JSON.parse(readFileSync(`${ROOT}config/agent.json`, "utf8"));
  const degraded: string[] = [];
  const notes: string[] = [];
  let spendCalls = 0, spendUsd = 0;

  const now = new Date();
  const hour = new Date(now); hour.setUTCMinutes(0, 0, 0);
  const hourIso = hour.toISOString().replace(".000Z", "Z");

  // Note which trigger started this run (ticker, schedule or manual) so the Settings page can show whether the
  // hourly chain is alive. Written even when the run turns out to be a no-op below.
  noteTrigger(now);

  // Same-hour guard: two triggers in one UTC hour must never make two paid purchases.
  if (!noPay) {
    const g = paidThisHourFromDisk(ROOT, hourIso);
    if (g.paid) {
      console.log(`SKIP: ${g.why}. Nothing to buy or record for ${hourIso}; this trigger is a no-op.`);
      return;
    }
  }

  console.log("Cost table (Ethereum Sepolia, test USDC, no real money)");
  console.log(`  price per call           $${PRICE.toFixed(2)} (10000 units, cap per payment 30000)`);
  console.log(`  paid calls per run (max) ${MAX_CALLS}  -> $${(MAX_CALLS * PRICE).toFixed(2)} worst case per run`);
  console.log(`  per day (24 runs)        $${(MAX_CALLS * PRICE * HOURS).toFixed(2)}`);
  console.log(`  to 1 Dec (${DAYS} days)       $${(MAX_CALLS * PRICE * HOURS * DAYS).toFixed(2)}`);
  console.log(`  planned this run         ${noPay ? 0 : 1 + (cfg.telegraph.power_miner ? Math.min(cfg.telegraph.power_nodes_max, cfg.nodes.length) : 0)} call(s)`);

  // ---- balance guard (a Sepolia RPC outage means we cannot prove the balance, so we do not pay) --------
  let canPay = !noPay;
  let usdcBalance: string | null = null;
  try {
    const bal = await balances();
    usdcBalance = bal.usdc;
    console.log(`wallet: ${bal.eth} ETH, ${bal.usdc} USDC`);
    if (canPay && BigInt(bal.usdcRaw) < MIN_USDC_RAW) {
      status("paused", { reason: `test-USDC balance ${bal.usdc} is below 0.20; no paid calls made`, usdc_balance: bal.usdc });
      console.error("PAUSED: balance below 0.20 test USDC. status written, nothing bought.");
      return;
    }
  } catch (e) {
    degraded.push(`Sepolia RPC: balance check failed (${msg(e)})`);
    if (canPay) { canPay = false; notes.push("paid call skipped: the wallet balance could not be checked"); }
  }

  // ---- public market inputs: each source fails on its own ---------------------------------------------
  let tip: number | null = null, btc: number | null = null;
  let w: (ReturnType<typeof windowHashprice> & { tip: number }) | null = null;
  let singleAtTip: number | null = null;
  try { tip = await fetchTipHeight(); } catch (e) { degraded.push(`mempool.space tip height: ${msg(e)}`); }
  try { btc = await fetchBtcUsd(); } catch (e) { degraded.push(`mempool.space BTC/USD price: ${msg(e)}`); }
  if (tip !== null) {
    try {
      const rows = await fetchBlocks(tip, 144);
      w = { tip, ...windowHashprice(rows) };
      singleAtTip = blockHashprice(rows[0].reward_sats, rows[0].difficulty);
    } catch (e) { degraded.push(`mempool.space last 144 blocks: ${msg(e)}`); }
  }

  // ---- Telegraph calls ----------------------------------------------------------------------------------
  async function paid(label: string, minerId: string, intent: string, params: Record<string, unknown>, valueKey: string): Promise<TelegraphCall> {
    const base: TelegraphCall = { intent, requested_miner: minerId, http_status: null, paid: false, cost_usd: null, value: null, accepted: false, receipt_file: null };
    let x: typeof import("./x402.js");
    try { x = await import("./x402.js"); } catch (e) {
      if (isFatal(e)) throw e; // missing or wrong key
      return { ...base, reject_reason: `payment client failed to load: ${msg(e)}` };
    }
    let out;
    try { out = await x.run({ label, minerId, intent, params }); }
    catch (e) {
      if (isFatal(e)) throw e;
      return { ...base, reject_reason: `call failed: ${msg(e)}` };
    }
    const rec = x.readReceipt(out.receipt_file!);
    const b = rec.response ?? {};
    // A settled payment that then failed upstream is credited back to escrow by the node; recorded, not billed.
    const billed = rec.http_status === 200 ? (b.cost_usd ?? null) : 0;
    if (!out.skipped && rec.paid) { spendCalls++; spendUsd += billed ?? PRICE; }
    const tr = rec.telegraph_receipt ?? {};
    return {
      intent, requested_miner: minerId, miner_id: b.miner_id ?? null, miner_name: b.miner_name ?? null,
      http_status: rec.http_status, paid: !!rec.paid, cost_usd: billed, field_status: b.field_status ?? null,
      value: typeof b.result?.[valueKey] === "number" ? b.result[valueKey] : null,
      returned_height: b.result?.block_height ?? null, signal_hash: b.signal_hash ?? null,
      receipt_hash: tr.receipt_hash ?? null, tx_hash: tr.tx_hash ?? rec.payment_response?.transaction ?? null,
      receipt_file: out.receipt_file ?? null, accepted: false,
    };
  }

  let hashCall: TelegraphCall | null = null;
  let hashValue: number | null = w ? w.hashprice_sats_per_ph_day : null;
  let hashSource: "telegraph" | "public" | null = w ? "public" : null;
  let hashLabel = w ? "public: mempool.space, mean of the last 144 blocks (reward incl. fees, difficulty)" : "unavailable: mempool.space blocks could not be read this run";

  if (canPay && tip !== null && w !== null) {
    hashCall = await paid(`hashprice-${tip}`, cfg.telegraph.hashprice_miner, "MINING_HASHPRICE_VERIFY_GENERAL", { block_height: tip }, "hashprice_sats_per_ph_day");
    const fs = hashCall.field_status ?? {};
    // Fields this agent relies on must be ok. hashprice_usd_per_ph_day is not required: USD is computed locally from the public BTC price.
    const bad = ["hashprice_sats_per_ph_day", "block_height", "hashrate_eh_s"].filter((k) => fs[k] !== "ok");
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
      // A value that is merely outside tolerance is a normal outcome. A call that failed is an upstream failure.
      if (hashCall.http_status !== 200) degraded.push(`Telegraph miner ${cfg.telegraph.hashprice_miner}: ${reason}`);
    }
  } else if (!noPay) {
    const why = !canPay ? "wallet balance could not be checked" : tip === null ? "no Bitcoin block height" : "no public 144-block value to verify against";
    notes.push(`Telegraph hashprice not bought this run: ${why}`);
    hashLabel += `; Telegraph value not bought: ${why}`;
  }

  // ---- power: public CAISO prices, optional Telegraph power miner once one has been proven ----------------
  const power: PowerPrice[] = [];
  let tgPowerLeft = canPay && cfg.telegraph.power_miner ? cfg.telegraph.power_nodes_max : 0;
  for (const node of cfg.nodes as string[]) {
    const p: PowerPrice = { node, day_ahead_usd_per_mwh: null, day_ahead_interval: null, real_time_usd_per_mwh: null, real_time_interval: null, telegraph: null, errors: [] };
    try { const d = await dayAhead(node, hour); p.day_ahead_usd_per_mwh = d.usd_per_mwh; p.day_ahead_interval = d.interval_start; }
    catch (e) { p.errors.push(`day-ahead: ${msg(e)}`); degraded.push(`CAISO OASIS day-ahead ${node}: ${msg(e)}`); }
    await sleep(5500); // CAISO OASIS asks for at least 5 seconds between requests
    try { const r = await realTime(node, now); p.real_time_usd_per_mwh = r.usd_per_mwh; p.real_time_interval = r.interval_start; }
    catch (e) { p.errors.push(`real-time: ${msg(e)}`); degraded.push(`CAISO OASIS real-time ${node}: ${msg(e)}`); }
    await sleep(5500);
    if (tgPowerLeft > 0) {
      tgPowerLeft--;
      const c = await paid(`power-${node}-${hourIso}`, cfg.telegraph.power_miner, "GRID_POWER_PRICE_GENERAL", { node_or_zone: node, interval_start: hourIso }, "lmp_usd_per_mwh");
      const ref = p.day_ahead_usd_per_mwh;
      const diff = c.value !== null && ref !== null ? Math.abs(c.value - ref) : null;
      const tol = ref !== null ? Math.max(cfg.tolerance.power_abs_usd, Math.abs(ref) * cfg.tolerance.power_rel) : null;
      if (c.http_status !== 200) { c.reject_reason = c.reject_reason ?? `HTTP ${c.http_status}`; degraded.push(`Telegraph power miner ${cfg.telegraph.power_miner} ${node}: ${c.reject_reason}`); }
      else if (c.field_status?.lmp_usd_per_mwh !== "ok") c.reject_reason = "lmp field not ok";
      else if (diff === null || tol === null) c.reject_reason = "no CAISO reference to check against";
      else if (diff > tol) c.reject_reason = `differs $${diff.toFixed(2)} from CAISO day-ahead (limit $${tol.toFixed(2)})`;
      else c.accepted = true;
      p.telegraph = c;
    }
    power.push(p);
  }

  // ---- tape ---------------------------------------------------------------------------------------------
  // Accounting follows the calls the tape references, so a second run in the same hour (which skips an
  // identical purchase) still reports what that hour cost.
  const tapeCalls = [hashCall, ...power.map((p) => p.telegraph)].filter((c): c is TelegraphCall => !!c && c.paid);
  const tapeSpend = { paid_calls: tapeCalls.length, cost_usd: Number(tapeCalls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(2)) };
  if (noPay) notes.push("run with --no-pay: no Telegraph data bought");
  for (const p of power) if (p.real_time_usd_per_mwh === null && p.day_ahead_usd_per_mwh === null) notes.push(`${p.node}: no power price available`);
  const tape: MarketTape = {
    schema: 1, interval_start: hourIso, recorded_at: now.toISOString(), block_height: tip, btc_usd: btc,
    hashprice: { value_sats_per_ph_day: hashValue, source: hashSource, label: hashLabel, public_144: w, telegraph: hashCall, public_at_telegraph_height: singleAtTip },
    power, spend: tapeSpend, wallet_usdc_after: usdcBalance, notes, degraded,
  };
  try { tape.wallet_usdc_after = (await balances()).usdc; } catch { /* keep the earlier reading, or null */ }

  const tapeQuality = (t: MarketTape) => tapeScore({ hashprice: t.hashprice.value_sats_per_ph_day, btc: t.btc_usd, powerNodesWithPrice: t.power.filter((p) => selectPower(p).usd_per_mwh !== null).length });
  const entryQuality = (h: HistoryEntry) => tapeScore({ hashprice: h.hashprice_sats_per_ph_day, btc: h.btc_usd, powerNodesWithPrice: h.power.filter((p) => p.usd_per_mwh !== null).length });

  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  write(`data/market/${stamp}.json`, tape); // every run is kept on record

  // A degraded rerun in the same hour must not replace a more complete tape for that hour.
  const prevLatest = readJson<MarketTape>("data/latest.json");
  const keepLatest = !!prevLatest && prevLatest.interval_start === hourIso && tapeQuality(prevLatest) > tapeQuality(tape);
  if (keepLatest) notes.push("kept the more complete earlier tape for this hour as latest.json and history");
  else write("data/latest.json", tape);

  const hist: HistoryEntry[] = readJson<HistoryEntry[]>("data/history.json") ?? [];
  const prevEntry = hist.find((h) => h.interval_start === hourIso);
  if (!(prevEntry && entryQuality(prevEntry) > entryQuality(toHistoryEntry(tape)))) {
    write("data/history.json", [...hist.filter((h) => h.interval_start !== hourIso), toHistoryEntry(tape)].slice(-HISTORY_MAX));
  }
  if (!dry) console.log(`ledger rows: ${writeLedger()}`);

  const state: State = degraded.length ? "degraded" : "ok";
  status(state, {
    usdc_balance: tape.wallet_usdc_after, last_tape: `data/market/${stamp}.json`, paid_calls_last_run: spendCalls,
    cost_usd_last_run: Number(spendUsd.toFixed(2)), hashprice_source: hashSource, ...(degraded.length ? { degraded, reason: `${degraded.length} upstream problem(s); see degraded list` } : {}),
  });

  console.log(`\ninterval ${hourIso} | block ${tip ?? "n/a"} | BTC ${btc !== null ? `$${btc}` : "n/a"}`);
  console.log(hashValue !== null && w ? `hashprice ${hashValue.toFixed(1)} sats/PH/day (${hashSource}); single block at tip ${singleAtTip?.toFixed(1)}, 144-block range ${w.min_block.toFixed(0)}..${w.max_block.toFixed(0)}` : "hashprice unavailable this run");
  console.log(`  ${hashLabel}`);
  for (const p of power) console.log(`${p.node}: real-time ${p.real_time_usd_per_mwh ?? "n/a"}  day-ahead ${p.day_ahead_usd_per_mwh ?? "n/a"} $/MWh`);
  console.log(`spent this run: ${spendCalls} call(s), $${spendUsd.toFixed(2)}; tape accounts for ${tapeSpend.paid_calls} paid call(s), $${tapeSpend.cost_usd.toFixed(2)}; wallet ${tape.wallet_usdc_after ?? "unknown"} USDC${dry ? " [dry run: nothing written]" : ""}`);
  for (const d of degraded) warn(d);
  console.log(`run state: ${state}${degraded.length ? ` (${degraded.length} upstream problem(s), exit code 0)` : ""}`);
}

main().catch((e) => {
  // A real failure: unusable key, unreadable config, failed write, or an unexpected bug.
  console.error(`ERROR: ${msg(e)}`);
  try { status("error", { reason: msg(e) }); } catch { /* nothing more we can do */ }
  process.exitCode = 1;
});
