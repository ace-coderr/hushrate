// Hushrate market agent: one run records one hourly MARKET tape. No site data, no decisions.
//   tsx src/agent.ts            buy hashprice and the BTC price from Telegraph (test USDC), write the tape
//   tsx src/agent.ts --no-pay   public sources only, spends nothing
//   tsx src/agent.ts --dry      print the tape, write nothing
//
// Two paid intents per run: MINING_HASHPRICE_VERIFY_GENERAL and CRYPTO_PRICE_USD (BTC). Each is bought only if the
// current UTC hour has not already paid for it (see guard.ts). A bought value is used for decisions only when it
// verifies against a public source; otherwise the public value is used and the tape says why.
//
// Exit codes: 0 for a clean run, a degraded run (an upstream source failed; recorded in the tape and in
// data/status.json) and a paused run (balance below the minimum). Non-zero only for real failures: an unusable key,
// a refused network config, unreadable config, a failed write, or an unexpected bug.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchTipHeight, fetchBtcUsd, fetchBlocks, windowHashprice, blockHashprice, toHistoryEntry, selectPower, tapeScore, checkBtcPurchase,
  type MarketTape, type PowerPrice, type TelegraphCall, type HistoryEntry,
} from "@hushrate/core";
import { balances } from "./wallet.js";
import { dayAhead, realTime } from "./caiso.js";
import { writeLedger } from "./ledger.js";
import { allBought, purchasesThisHourFromDisk } from "./guard.js";
import { loadNetwork } from "./network.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const noPay = process.argv.includes("--no-pay");
const dry = process.argv.includes("--dry");
const HISTORY_MAX = 500;
const PRICE = 0.01, HOURS = 24, DAYS = 19;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A key, wallet or network-config problem is a real failure, never a degraded run. */
const isFatal = (e: unknown) => /EVM_PRIVATE_KEY|Configured key controls|NETWORK CONFIG/.test(msg(e));

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
  const net = loadNetwork();
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

  // Same-hour guard, per intent: two triggers in one UTC hour must never buy the same thing twice, and a half-bought
  // hour buys only what is missing. An hour that already paid for both is a no-op.
  const bought = noPay ? { hashprice: false, btc: false, why: {} } : purchasesThisHourFromDisk(ROOT, hourIso);
  if (!noPay && allBought(bought)) {
    console.log(`SKIP: ${bought.why.hashprice}; ${bought.why.btc}. Nothing to buy or record for ${hourIso}; this trigger is a no-op.`);
    return;
  }
  if (bought.hashprice) console.log(`hashprice already bought this hour: ${bought.why.hashprice}`);
  if (bought.btc) console.log(`BTC price already bought this hour: ${bought.why.btc}`);
  const priorTape = readJson<MarketTape>("data/latest.json");
  const prior = priorTape && priorTape.interval_start === hourIso ? priorTape : null;

  const plannedCalls = noPay ? 0 : (bought.hashprice ? 0 : 1) + (bought.btc ? 0 : 1) + (cfg.telegraph.power_miner ? Math.min(cfg.telegraph.power_nodes_max, cfg.nodes.length) : 0);
  const perRun = (noPay ? 0 : 2) * PRICE;
  console.log(`Cost table (${net.label}, ${net.testnet ? "test USDC, no real money" : "REAL USDC"})`);
  console.log(`  price per call            $${PRICE.toFixed(2)} (10000 units); cap per payment ${net.max_amount_per_payment} units`);
  console.log(`  paid calls per run        2 planned (hashprice + BTC price), hard cap ${net.max_paid_calls_per_run}`);
  console.log(`  per run                   $${perRun.toFixed(2)}`);
  console.log(`  per day (24 runs)         $${(perRun * HOURS).toFixed(2)}`);
  console.log(`  to 1 Dec (${DAYS} days)        $${(perRun * HOURS * DAYS).toFixed(2)}`);
  console.log(`  planned this run          ${plannedCalls} call(s)`);

  // ---- balance guard (an RPC outage means we cannot prove the balance, so we do not pay) ----------------
  let canPay = !noPay;
  let usdcBalance: string | null = null;
  try {
    const bal = await balances();
    usdcBalance = bal.usdc;
    console.log(`wallet: ${bal.eth} ETH, ${bal.usdc} USDC`);
    if (canPay && BigInt(bal.usdcRaw) < net.min_balance_units) {
      status("paused", { reason: `USDC balance ${bal.usdc} is below the minimum (${Number(net.min_balance_units) / 10 ** net.usdc.decimals}); no paid calls made`, usdc_balance: bal.usdc });
      console.error("PAUSED: balance below the minimum. status written, nothing bought.");
      return;
    }
  } catch (e) {
    degraded.push(`${net.label} RPC: balance check failed (${msg(e)})`);
    if (canPay) { canPay = false; notes.push("paid calls skipped: the wallet balance could not be checked"); }
  }

  // ---- public market inputs: each source fails on its own ---------------------------------------------
  let tip: number | null = null, btcPublic: number | null = null;
  let w: (ReturnType<typeof windowHashprice> & { tip: number }) | null = null;
  let singleAtTip: number | null = null;
  try { tip = await fetchTipHeight(); } catch (e) { degraded.push(`mempool.space tip height: ${msg(e)}`); }
  try { btcPublic = await fetchBtcUsd(); } catch (e) { degraded.push(`mempool.space BTC/USD price: ${msg(e)}`); }
  if (tip !== null) {
    try {
      const rows = await fetchBlocks(tip, 144);
      w = { tip, ...windowHashprice(rows) };
      singleAtTip = blockHashprice(rows[0].reward_sats, rows[0].difficulty);
    } catch (e) { degraded.push(`mempool.space last 144 blocks: ${msg(e)}`); }
  }

  // ---- Telegraph calls ----------------------------------------------------------------------------------
  async function paid(label: string, minerId: string, intent: string, params: Record<string, unknown>, valueKey: string, dedupe?: string): Promise<TelegraphCall> {
    const base: TelegraphCall = { intent, requested_miner: minerId, http_status: null, paid: false, cost_usd: null, value: null, accepted: false, receipt_file: null };
    let x: typeof import("./x402.js");
    try { x = await import("./x402.js"); } catch (e) {
      if (isFatal(e)) throw e; // missing or wrong key, or a refused network
      return { ...base, reject_reason: `payment client failed to load: ${msg(e)}` };
    }
    let out;
    try { out = await x.run({ label, minerId, intent, params, dedupe }); }
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

  // ---- hashprice ----
  let hashCall: TelegraphCall | null = null;
  let hashValue: number | null = w ? w.hashprice_sats_per_ph_day : null;
  let hashSource: "telegraph" | "public" | null = w ? "public" : null;
  let hashLabel = w ? "public: mempool.space, mean of the last 144 blocks (reward incl. fees, difficulty)" : "unavailable: mempool.space blocks could not be read this run";
  let tapeBlock = tip, tapePublic144 = w, tapeSingle = singleAtTip;

  const reuseHash = bought.hashprice && prior?.hashprice.telegraph?.paid ? prior : null;
  if (reuseHash) {
    // Already bought (and verified) earlier this hour: keep that purchase exactly as recorded, with its own block and public check.
    hashCall = reuseHash.hashprice.telegraph; hashValue = reuseHash.hashprice.value_sats_per_ph_day; hashSource = reuseHash.hashprice.source;
    hashLabel = `${reuseHash.hashprice.label} (kept from the earlier run this hour)`;
    tapeBlock = reuseHash.block_height; tapePublic144 = reuseHash.hashprice.public_144; tapeSingle = reuseHash.hashprice.public_at_telegraph_height;
  } else if (canPay && !bought.hashprice && tip !== null && w !== null) {
    hashCall = await paid(`hashprice-${tip}`, cfg.telegraph.hashprice_miner, "MINING_HASHPRICE_VERIFY_GENERAL", { block_height: tip }, "hashprice_sats_per_ph_day");
    const fs = hashCall.field_status ?? {};
    // Fields this agent relies on must be ok. hashprice_usd_per_ph_day is not required: USD is computed locally.
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
      // A value merely outside tolerance is a normal outcome. A call that failed is an upstream failure.
      if (hashCall.http_status !== 200) degraded.push(`Telegraph miner ${cfg.telegraph.hashprice_miner} (hashprice): ${reason}`);
    }
  } else if (!noPay) {
    const why = bought.hashprice ? "a purchase for this hour exists but its tape was not found" : !canPay ? "wallet balance could not be checked" : tip === null ? "no Bitcoin block height" : "no public 144-block value to verify against";
    notes.push(`Telegraph hashprice not bought this run: ${why}`);
    hashLabel += `; Telegraph value not bought: ${why}`;
  }

  // ---- BTC/USD price (second paid intent) ----
  let btcCall: TelegraphCall | null = null;
  let btcValue: number | null = btcPublic;
  let btcSource: "telegraph" | "public" | null = btcPublic !== null ? "public" : null;
  let btcLabel = btcPublic !== null ? "public: mempool.space BTC/USD" : "unavailable: mempool.space BTC/USD could not be read this run";

  const reuseBtc = bought.btc && prior?.btc?.telegraph?.paid ? prior.btc : null;
  if (reuseBtc) {
    btcCall = reuseBtc.telegraph; btcValue = reuseBtc.value_usd; btcSource = reuseBtc.source; btcLabel = `${reuseBtc.label} (kept from the earlier run this hour)`;
  } else if (canPay && !bought.btc && btcPublic !== null) {
    btcCall = await paid(`btc-${hourIso.replace(/:/g, "-")}`, cfg.telegraph.btc_miner, "CRYPTO_PRICE_USD", { symbol: "BTC" }, "price_usd", hourIso);
    const { accepted, reason: reasonB } = checkBtcPurchase(btcCall, btcPublic, cfg.tolerance.btc_rel);
    if (accepted) {
      btcCall.accepted = true; btcValue = btcCall.value as number; btcSource = "telegraph";
      btcLabel = `Telegraph miner ${btcCall.miner_id}, within ${cfg.tolerance.btc_rel * 100}% of the public mempool.space price`;
    } else {
      btcCall.reject_reason = reasonB ?? "rejected";
      btcLabel += `; Telegraph price not used: ${reasonB}`;
      if (btcCall.http_status !== 200) degraded.push(`Telegraph miner ${cfg.telegraph.btc_miner} (BTC price): ${reasonB}`);
    }
  } else if (!noPay) {
    const why = bought.btc ? "a purchase for this hour exists but its tape was not found" : !canPay ? "wallet balance could not be checked" : "no public BTC/USD price to verify against";
    notes.push(`Telegraph BTC price not bought this run: ${why}`);
    btcLabel += `; Telegraph price not bought: ${why}`;
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
      const c = await paid(`power-${node}-${hourIso.replace(/:/g, "-")}`, cfg.telegraph.power_miner, "GRID_POWER_PRICE_GENERAL", { node_or_zone: node, interval_start: hourIso }, "lmp_usd_per_mwh", hourIso);
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
  // Accounting follows the calls the tape references (including purchases kept from an earlier run this hour).
  const tapeCalls = [hashCall, btcCall, ...power.map((p) => p.telegraph)].filter((c): c is TelegraphCall => !!c && c.paid);
  const tapeSpend = { paid_calls: tapeCalls.length, cost_usd: Number(tapeCalls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(2)) };
  if (noPay) notes.push("run with --no-pay: no Telegraph data bought");
  for (const p of power) if (p.real_time_usd_per_mwh === null && p.day_ahead_usd_per_mwh === null) notes.push(`${p.node}: no power price available`);
  const tape: MarketTape = {
    schema: 1, interval_start: hourIso, recorded_at: now.toISOString(), block_height: tapeBlock,
    // btc_usd is the price decisions use: the verified Telegraph price when it passed the check, else the public price.
    btc_usd: btcValue,
    hashprice: { value_sats_per_ph_day: hashValue, source: hashSource, label: hashLabel, public_144: tapePublic144, telegraph: hashCall, public_at_telegraph_height: tapeSingle },
    btc: { value_usd: btcValue, source: btcSource, label: btcLabel, public_usd: btcPublic ?? reuseBtc?.public_usd ?? null, tolerance_rel: cfg.tolerance.btc_rel, telegraph: btcCall },
    power, spend: tapeSpend, wallet_usdc_after: usdcBalance, notes, degraded,
  };
  try { tape.wallet_usdc_after = (await balances()).usdc; } catch { /* keep the earlier reading, or null */ }

  const tapeQuality = (t: MarketTape) => tapeScore({ hashprice: t.hashprice.value_sats_per_ph_day, btc: t.btc_usd, powerNodesWithPrice: t.power.filter((p) => selectPower(p).usd_per_mwh !== null).length });
  const entryQuality = (h: HistoryEntry) => tapeScore({ hashprice: h.hashprice_sats_per_ph_day, btc: h.btc_usd, powerNodesWithPrice: h.power.filter((p) => p.usd_per_mwh !== null).length });

  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  write(`data/market/${stamp}.json`, tape); // every run is kept on record

  // A degraded rerun in the same hour must not replace a more complete tape for that hour.
  const keepLatest = !!prior && tapeQuality(prior) > tapeQuality(tape);
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
    cost_usd_last_run: Number(spendUsd.toFixed(2)), hashprice_source: hashSource, btc_source: btcSource,
    ...(degraded.length ? { degraded, reason: `${degraded.length} upstream problem(s); see degraded list` } : {}),
  });

  console.log(`\ninterval ${hourIso} | block ${tapeBlock ?? "n/a"} | BTC ${btcValue !== null ? `$${btcValue}` : "n/a"} (${btcSource ?? "none"})`);
  console.log(`  btc: ${btcLabel}`);
  console.log(hashValue !== null && tapePublic144 ? `hashprice ${hashValue.toFixed(1)} sats/PH/day (${hashSource}); single block ${tapeSingle?.toFixed(1)}, 144-block range ${tapePublic144.min_block.toFixed(0)}..${tapePublic144.max_block.toFixed(0)}` : "hashprice unavailable this run");
  console.log(`  ${hashLabel}`);
  for (const p of power) console.log(`${p.node}: real-time ${p.real_time_usd_per_mwh ?? "n/a"}  day-ahead ${p.day_ahead_usd_per_mwh ?? "n/a"} $/MWh`);
  console.log(`spent this run: ${spendCalls} call(s), $${spendUsd.toFixed(2)}; tape accounts for ${tapeSpend.paid_calls} paid call(s), $${tapeSpend.cost_usd.toFixed(2)}; wallet ${tape.wallet_usdc_after ?? "unknown"} USDC${dry ? " [dry run: nothing written]" : ""}`);
  for (const d of degraded) warn(d);
  console.log(`run state: ${state}${degraded.length ? ` (${degraded.length} upstream problem(s), exit code 0)` : ""}`);
}

main().catch((e) => {
  // A real failure: unusable key, refused network, unreadable config, failed write, or an unexpected bug.
  console.error(`ERROR: ${msg(e)}`);
  try { status("error", { reason: msg(e) }); } catch { /* nothing more we can do */ }
  process.exitCode = 1;
});
