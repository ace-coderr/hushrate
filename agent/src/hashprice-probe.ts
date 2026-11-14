// Probes other miners for MINING_HASHPRICE_VERIFY_GENERAL with real paid calls (test USDC), one call per miner.
//   MEMPOOL_BASE=https://mempool.emzy.de tsx src/hashprice-probe.ts <minerId> [... up to 5]
// Hard cap: at most 5 calls and at most $0.06 in total (the per-payment cap of 3 cents also applies in x402.ts).
// Each value is compared with the public single-block hashprice recomputed at the height the miner RETURNED.
// Free block reads come from a mempool.space-compatible API: reward and difficulty are chain data, identical on any instance.
import { mkdirSync, writeFileSync } from "node:fs";
import { blockHashprice } from "@hushrate/core";
import { run, readReceipt, ROOT, paidCount } from "./x402.js";

const BASE = (process.env.MEMPOOL_BASE ?? "https://mempool.space").replace(/\/$/, "");
const MAX_CALLS = 5, PRICE_USD = 0.01, MAX_TOTAL_USD = 0.06;
const ids = process.argv.slice(2);
if (!ids.length || ids.length > MAX_CALLS) throw new Error(`give 1 to ${MAX_CALLS} miner ids`);
if (ids.length * PRICE_USD > MAX_TOTAL_USD + 1e-9) throw new Error(`budget: ${ids.length} calls would exceed $${MAX_TOTAL_USD}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** GET with polite retries: the free mirrors rate-limit (HTTP 429) after a burst of reads. */
async function getText(url: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    let r: Response;
    try { r = await fetch(url, { signal: AbortSignal.timeout(30000) }); } catch { await sleep(4000 * (i + 1)); continue; } // network error: retry
    if (r.ok) return r.text();
    if (r.status !== 429) throw new Error(`${url} -> HTTP ${r.status}`);
    await sleep(4000 * (i + 1));
  }
  throw new Error(`${url} stayed rate limited`);
}

async function blockAt(h: number) {
  const b = (JSON.parse(await getText(`${BASE}/api/v1/blocks/${h}`)) as any[]).find((x) => x.height === h);
  if (!b) throw new Error(`block ${h} not in the page`);
  return { height: h, reward: b.extras.reward as number, fees: b.extras.totalFees as number, difficulty: b.difficulty as number };
}

// The tip comes from a second, independent source so a rate-limited mirror cannot corrupt the request.
const tip = Number((await getText("https://blockstream.info/api/blocks/tip/height")).trim());
if (!Number.isInteger(tip) || tip < 900000) throw new Error(`implausible tip height: ${tip}`);
await blockAt(tip); // fail before paying if the block data is not readable
console.log(`tip ${tip}; block data from ${BASE}; probing ${ids.length} miner(s), worst case $${(ids.length * PRICE_USD).toFixed(2)}`);

const results: unknown[] = [];
for (const id of ids) {
  const row: Record<string, unknown> = { miner_requested: id, requested_height: tip };
  try {
    const o = await run({ label: `probe-hashprice-${id}`, minerId: id, intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: tip } });
    const rec = readReceipt(o.receipt_file!);
    const b = rec.response ?? {};
    const v = b.result?.hashprice_sats_per_ph_day;
    const rh = b.result?.block_height ?? null;
    Object.assign(row, {
      http_status: rec.http_status, paid: rec.paid, miner_id: b.miner_id, miner_name: b.miner_name, endpoint: b.endpoint,
      value_sats_per_ph_day: v ?? null, returned_height: rh, hashrate_eh_s: b.result?.hashrate_eh_s ?? null,
      field_status: b.field_status, cost_usd: b.cost_usd, duration_ms: b.duration_ms, receipt_file: o.receipt_file,
      error: rec.http_status >= 400 ? b : undefined,
    });
    if (typeof v === "number" && typeof rh === "number") {
      const pub = await blockAt(rh);
      const p = blockHashprice(pub.reward, pub.difficulty);
      Object.assign(row, { public_at_returned_height: p, rel_diff: (v - p) / p, within_1pct: Math.abs((v - p) / p) <= 0.01, height_matches_request: rh === tip });
    }
  } catch (e) { row.error = String(e); }
  results.push(row);
  console.log(JSON.stringify(row).slice(0, 600));
}
mkdirSync(`${ROOT}data/probe`, { recursive: true });
const file = `data/probe/hashprice-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(`${ROOT}${file}`, JSON.stringify({ ran_at: new Date().toISOString(), tip, mempool_base: BASE, paid_attempts: paidCount(), max_total_usd: MAX_TOTAL_USD, results }, null, 2));
console.log(`saved ${file}; paid attempts ${paidCount()}`);
