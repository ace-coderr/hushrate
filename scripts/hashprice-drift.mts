// Hashprice drift analysis. Uses ONLY recorded tapes and receipts, plus free block reads from a mempool.space-compatible
// API (reward, fees, difficulty are chain data: any instance returns the same values). No payments are made.
//
//   npx tsx scripts/hashprice-drift.mts                    uses data/analysis/blocks.json if complete, else fetches
//   MEMPOOL_BASE=https://mempool.emzy.de npx tsx scripts/hashprice-drift.mts
//
// Writes docs/hashprice-drift.md (table, acceptance rates, hypothesis results) and data/analysis/hashprice-drift.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blockHashprice } from "@hushrate/core";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASE = (process.env.MEMPOOL_BASE ?? "https://mempool.space").replace(/\/$/, "");
const CACHE = `${ROOT}data/analysis/blocks.json`;
const WINDOWS = [1, 2, 3, 6, 12, 24, 72, 144, 288];

interface Blk { height: number; difficulty: number; reward: number; fees: number; time: number; }
interface Purchase {
  at: string; tape: string; value: number; returnedHeight: number | null; tapeBlock: number | null; hashrateEh: number | null;
  public144: number | null; publicAtHeightRecorded: number | null; accepted: boolean; reason: string | null; receiptHash: string | null;
}

const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x: number | null, d = 2) => (x === null || !Number.isFinite(x) ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 1. purchases from the recorded tapes (one row per distinct settled purchase) -------------------------------
function loadPurchases(): Purchase[] {
  const dir = `${ROOT}data/market`;
  const seen = new Map<string, Purchase>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const t = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const c = t.hashprice?.telegraph;
    if (!c || typeof c.value !== "number") continue;
    const key = c.receipt_hash ?? `${c.returned_height}:${c.value}`;
    if (seen.has(key)) continue; // a later run in the same hour reuses the same purchase
    let hashrate: number | null = null;
    if (c.receipt_file && existsSync(`${ROOT}data/receipts/${c.receipt_file}`)) {
      try { hashrate = JSON.parse(readFileSync(`${ROOT}data/receipts/${c.receipt_file}`, "utf8")).response?.result?.hashrate_eh_s ?? null; } catch { /* ignore */ }
    }
    seen.set(key, {
      at: t.recorded_at, tape: f, value: c.value, returnedHeight: c.returned_height ?? null, tapeBlock: t.block_height ?? null, hashrateEh: hashrate,
      public144: t.hashprice.public_144?.hashprice_sats_per_ph_day ?? null, publicAtHeightRecorded: t.hashprice.public_at_telegraph_height ?? null,
      accepted: !!c.accepted, reason: c.reject_reason ?? null, receiptHash: c.receipt_hash ?? null,
    });
  }
  return [...seen.values()].sort((a, b) => a.at.localeCompare(b.at));
}

// ---- 2. blocks (cached, fetched only when missing) ----------------------------------------------------------------
async function loadBlocks(lo: number, hi: number): Promise<Map<number, Blk>> {
  const map = new Map<number, Blk>();
  if (existsSync(CACHE)) for (const b of JSON.parse(readFileSync(CACHE, "utf8")) as Blk[]) map.set(b.height, b);
  const missing = () => { for (let h = lo; h <= hi; h++) if (!map.has(h)) return h; return null; };
  let guard = 0;
  while (missing() !== null && guard++ < 400) {
    // Pages come newest first: ask from the highest missing height upward-aligned to a page that contains it.
    let top = hi; while (top >= lo && map.has(top)) top--;
    if (top < lo) break;
    const r = await fetch(`${BASE}/api/v1/blocks/${top}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${BASE} blocks/${top} -> HTTP ${r.status}`);
    for (const b of (await r.json()) as any[]) map.set(b.height, { height: b.height, difficulty: b.difficulty, reward: b.extras.reward, fees: b.extras.totalFees, time: b.timestamp });
    await sleep(250);
  }
  const miss = missing();
  if (miss !== null) throw new Error(`could not load block ${miss}`);
  mkdirSync(`${ROOT}data/analysis`, { recursive: true });
  writeFileSync(CACHE, JSON.stringify([...map.values()].sort((a, b) => a.height - b.height)) + "\n");
  return map;
}

const purchases = loadPurchases();
const heights = purchases.map((p) => p.returnedHeight).filter((h): h is number => h !== null);
const lo = Math.min(...heights) - Math.max(...WINDOWS), hi = Math.max(...heights) + 3;
const B = await loadBlocks(lo, hi);
const blk = (h: number) => B.get(h)!;
const single = (h: number) => blockHashprice(blk(h).reward, blk(h).difficulty);
/** Mean of per-block hashprice over the N blocks ending at h, each block at its own difficulty (what the agent does). */
const meanOwn = (h: number, n: number) => mean(Array.from({ length: n }, (_, i) => single(h - i)));
/** Mean reward over the N blocks ending at h, priced at the difficulty of block h (removes difficulty steps from the window). */
const meanAtCurrentDiff = (h: number, n: number) => (mean(Array.from({ length: n }, (_, i) => blk(h - i).reward)) * 1e15 * 86400) / (blk(h).difficulty * 2 ** 32);
const rel = (a: number, b: number) => (a - b) / b;

// ---- 3. table ------------------------------------------------------------------------------------------------------
interface Row extends Purchase { recomputedAtHeight: number | null; diffVs144: number | null; diffVsHeight: number | null; recordedVsRecomputed: number | null; adjustedInWindow: boolean; }
const rows: Row[] = purchases.map((p) => {
  const h = p.returnedHeight;
  const rc = h !== null ? single(h) : null;
  const adjusted = h !== null && Array.from({ length: 144 }, (_, i) => blk(h - i).difficulty).some((d) => d !== blk(h).difficulty);
  return { ...p, recomputedAtHeight: rc, diffVs144: p.public144 !== null ? rel(p.value, p.public144) : null, diffVsHeight: rc !== null ? rel(p.value, rc) : null,
    recordedVsRecomputed: rc !== null && p.publicAtHeightRecorded !== null ? rel(p.publicAtHeightRecorded, rc) : null, adjustedInWindow: adjusted };
});

const latestAt = rows.length ? new Date(rows[rows.length - 1].at).getTime() : 0;
const last24 = rows.filter((r) => latestAt - new Date(r.at).getTime() <= 24 * 3600_000);
const rate = (rs: Row[], f: (r: Row) => boolean) => ({ n: rs.length, ok: rs.filter(f).length });
const fmtRate = (x: { n: number; ok: number }) => `${x.ok} of ${x.n} (${x.n ? ((x.ok / x.n) * 100).toFixed(1) : "n/a"}%)`;
const acc = (r: Row) => r.accepted;
const matchesHeight = (r: Row) => r.diffVsHeight !== null && Math.abs(r.diffVsHeight) <= 0.01;

// ---- 4. hypotheses -------------------------------------------------------------------------------------------------
const ok = rows.filter((r) => r.returnedHeight !== null);
const windowStats = WINDOWS.map((n) => {
  const errsOwn = ok.map((r) => Math.abs(rel(r.value, meanOwn(r.returnedHeight!, n))));
  const errsCur = ok.map((r) => Math.abs(rel(r.value, meanAtCurrentDiff(r.returnedHeight!, n))));
  return { n, medOwn: median(errsOwn), maxOwn: Math.max(...errsOwn), within1Own: errsOwn.filter((e) => e <= 0.01).length, medCur: median(errsCur), maxCur: Math.max(...errsCur), within1Cur: errsCur.filter((e) => e <= 0.01).length };
});
const subsidyOnly = ok.map((r) => Math.abs(rel(r.value, (((blk(r.returnedHeight!).reward - blk(r.returnedHeight!).fees) * 1e15 * 86400) / (blk(r.returnedHeight!).difficulty * 2 ** 32)))));
const prevDiff = ok.map((r) => Math.abs(rel(r.value, (blk(r.returnedHeight!).reward * 1e15 * 86400) / (blk(r.returnedHeight! - 1).difficulty * 2 ** 32))));
const lagStats = [-2, -1, 0, 1, 2, 3].map((k) => {
  const errs = ok.map((r) => { const h = r.returnedHeight! - k; return B.has(h) ? Math.abs(rel(r.value, single(h))) : NaN; }).filter((e) => Number.isFinite(e));
  return { k, med: median(errs), max: Math.max(...errs), within1: errs.filter((e) => e <= 0.01).length, n: errs.length };
});
// Hashrate-based formula: value = reward_sats * K / hashrate_PH_per_s. If K is constant the miner uses that formula.
const withHr = ok.filter((r) => r.hashrateEh !== null);
const impliedK = withHr.map((r) => (r.value * r.hashrateEh! * 1000) / blk(r.returnedHeight!).reward);
// Fee spikes: does the distance from the 144-block mean follow the fee share of the block?
const xs = ok.map((r) => blk(r.returnedHeight!).fees / blk(r.returnedHeight!).reward);
const ys = ok.map((r) => Math.abs(r.diffVs144 ?? 0));
const pearson = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); const num_ = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0); return num_ / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, y) => s + (y - mb) ** 2, 0)); };
const straddle = ok.filter((r) => r.adjustedInWindow), clean = ok.filter((r) => !r.adjustedInWindow);
const adjustments = [...B.values()].sort((a, b) => a.height - b.height).filter((b, i, arr) => i > 0 && b.difficulty !== arr[i - 1].difficulty).map((b) => ({ height: b.height, from: B.get(b.height - 1)!.difficulty, to: b.difficulty }));

// ---- 5. write ------------------------------------------------------------------------------------------------------
const range = (rs: Row[]) => (rs.length ? `${rs[0].at.slice(0, 16)} to ${rs[rs.length - 1].at.slice(0, 16)} UTC` : "n/a");
const md: string[] = [];
md.push("# Hashprice drift: Telegraph miner 71083 against the public 144-block value", "");
md.push("Generated by `scripts/hashprice-drift.mts` from the recorded tapes in `data/market/`, the receipts in `data/receipts/` and block data (reward, fees, difficulty) read from a mempool.space-compatible API and cached in `data/analysis/blocks.json`. No payments were made. Re-run with `npx tsx scripts/hashprice-drift.mts`.", "");
md.push("## Acceptance rate", "");
md.push("The agent's rule at the time: accept the Telegraph value only if it is within 1% of the public 144-block mean (each block at its own difficulty).", "");
md.push("| Period | Distinct purchases | Accepted by the 144-block rule | Within 1% of the public value at the returned height |", "|---|---|---|---|");
md.push(`| All recorded (${range(rows)}) | ${rows.length} | ${fmtRate(rate(rows, acc))} | ${fmtRate(rate(rows, matchesHeight))} |`);
md.push(`| Last 24 hours (${range(last24)}) | ${last24.length} | ${fmtRate(rate(last24, acc))} | ${fmtRate(rate(last24, matchesHeight))} |`, "");
md.push("## Every purchase", "");
md.push("`% vs 144` is Telegraph against the public 144-block mean the agent used. `% vs height` is Telegraph against the public single-block value recomputed here at the height Telegraph returned. `Adj` marks purchases whose 144-block window contains a difficulty adjustment.", "");
md.push("| Recorded (UTC) | Telegraph | Returned height | Tape block | Public 144 | Public at height (recomputed) | % vs 144 | % vs height | Adj | Accepted |", "|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) md.push(`| ${r.at.slice(0, 16).replace("T", " ")} | ${num(r.value)} | ${r.returnedHeight ?? "n/a"} | ${r.tapeBlock ?? "n/a"} | ${num(r.public144)} | ${num(r.recomputedAtHeight)} | ${pct(r.diffVs144)} | ${pct(r.diffVsHeight)} | ${r.adjustedInWindow ? "yes" : ""} | ${r.accepted ? "yes" : "no"} |`);
md.push("");
md.push("## Hypotheses", "");
md.push(`Difficulty adjustments inside the analysed block range: ${adjustments.length ? adjustments.map((a) => `at block ${a.height} (${(a.from / 1e12).toFixed(2)}T to ${(a.to / 1e12).toFixed(2)}T, ${pct(rel(a.to, a.from))})`).join("; ") : "none"}.`, "");
md.push("### (a) A different window", "", "Median and worst absolute error of the Telegraph value against the mean over the last N blocks ending at the returned height. \"Own difficulty\" prices each block at its own difficulty (the agent's 144-block definition). \"Current difficulty\" averages the reward over the window but prices it at the difficulty of the latest block.", "");
md.push("| N blocks | Median error, own difficulty | Worst | Within 1% | Median error, current difficulty | Worst | Within 1% |", "|---|---|---|---|---|---|---|");
for (const w of windowStats) md.push(`| ${w.n} | ${pct(w.medOwn)} | ${pct(w.maxOwn)} | ${w.within1Own} of ${ok.length} | ${pct(w.medCur)} | ${pct(w.maxCur)} | ${w.within1Cur} of ${ok.length} |`);
md.push("", "### (b) A different reward or fee definition", "");
md.push(`- Subsidy only (reward minus fees) at the returned height: median error ${pct(median(subsidyOnly))}, worst ${pct(Math.max(...subsidyOnly))}.`);
md.push(`- Reward of the returned block priced at the previous block's difficulty: median error ${pct(median(prevDiff))}, worst ${pct(Math.max(...prevDiff))}.`);
md.push(`- Hashrate-based formula (value = reward x K / hashrate): implied K ranges ${num(Math.min(...impliedK), 1)} to ${num(Math.max(...impliedK), 1)} over ${withHr.length} purchases (median ${num(median(impliedK), 1)}); a constant K would mean the miner uses that formula.`, "");
md.push("### (c) The latest block only, or a lag", "", "Telegraph against the single-block public value at the returned height shifted by k blocks (k = 0 is the returned height, k > 0 is earlier, k < 0 is later).", "");
md.push("| k | Median error | Worst | Within 1% |", "|---|---|---|---|");
for (const l of lagStats) md.push(`| ${l.k} | ${pct(l.med)} | ${pct(l.max)} | ${l.within1} of ${l.n} |`);
md.push("", "### (d) Fee spikes and difficulty steps", "");
md.push(`- Correlation between the fee share of the returned block and the distance from the 144-block mean: r = ${pearson(xs, ys).toFixed(2)} over ${ok.length} purchases.`);
md.push(`- Purchases whose 144-block window contains a difficulty adjustment: ${straddle.length}; median distance from the 144-block mean ${pct(median(straddle.map((r) => Math.abs(r.diffVs144 ?? 0))))}, accepted ${fmtRate(rate(straddle as Row[], acc))}.`);
md.push(`- Purchases whose window does not: ${clean.length}; median distance ${pct(median(clean.map((r) => Math.abs(r.diffVs144 ?? 0))))}, accepted ${fmtRate(rate(clean as Row[], acc))}.`);
md.push(`- Recorded single-block value in the tape against the value recomputed here: median difference ${pct(median(rows.map((r) => Math.abs(r.recordedVsRecomputed ?? 0))), 4)}.`, "");
if (existsSync(`${ROOT}docs/hashprice-findings.md`)) md.push(readFileSync(`${ROOT}docs/hashprice-findings.md`, "utf8").trim(), "");
writeFileSync(`${ROOT}docs/hashprice-drift.md`, md.join("\n"));
mkdirSync(`${ROOT}data/analysis`, { recursive: true });
writeFileSync(`${ROOT}data/analysis/hashprice-drift.json`, JSON.stringify({ rows, windowStats, lagStats, adjustments, acceptance: { all: rate(rows, acc), last24: rate(last24, acc), allMatchHeight: rate(rows, matchesHeight), last24MatchHeight: rate(last24, matchesHeight) } }, null, 2) + "\n");
console.log(`purchases ${rows.length} | accepted (144 rule) all ${fmtRate(rate(rows, acc))}, last 24h ${fmtRate(rate(last24, acc))}`);
console.log(`within 1% of the public value AT the returned height: all ${fmtRate(rate(rows, matchesHeight))}, last 24h ${fmtRate(rate(last24, matchesHeight))}`);
console.log("windows (median err own diff | current diff):", windowStats.map((w) => `${w.n}: ${pct(w.medOwn)} | ${pct(w.medCur)}`).join(" ; "));
console.log("lag:", lagStats.map((l) => `k${l.k}: ${pct(l.med)}`).join(" ; "));
console.log("subsidy-only median", pct(median(subsidyOnly)), "| prev-diff median", pct(median(prevDiff)), "| implied K", num(Math.min(...impliedK)), "..", num(Math.max(...impliedK)), "| fee corr", pearson(xs, ys).toFixed(2));
console.log("adjustments:", adjustments.map((a) => `${a.height} ${pct(rel(a.to, a.from))}`).join(", "));
console.log(`straddle ${straddle.length}: median ${pct(median(straddle.map((r) => Math.abs(r.diffVs144 ?? 0))))} accepted ${fmtRate(rate(straddle as Row[], acc))} | clean ${clean.length}: median ${pct(median(clean.map((r) => Math.abs(r.diffVs144 ?? 0))))} accepted ${fmtRate(rate(clean as Row[], acc))}`);
