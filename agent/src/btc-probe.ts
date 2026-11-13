// Probes candidate miners for CRYPTO_PRICE_USD (BTC) with real paid calls (test USDC, at most 3 per process).
//   tsx src/btc-probe.ts <minerId> [<minerId> [<minerId>]]
// Reference price: live mempool.space when reachable, otherwise the BTC price on the latest recorded tape
// (itself read from mempool.space), with its age printed so the comparison is honest.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { run, readReceipt, ROOT, paidCount } from "./x402.js";

const ids = process.argv.slice(2);
if (!ids.length || ids.length > 3) throw new Error("give 1 to 3 miner ids");

let ref: { usd: number; source: string } | null = null;
try {
  const r = await fetch("https://mempool.space/api/v1/prices", { signal: AbortSignal.timeout(8000) });
  if (r.ok) ref = { usd: (await r.json()).USD, source: "mempool.space live" };
} catch { /* fall through to the tape */ }
if (!ref) {
  const t = JSON.parse(readFileSync(`${ROOT}data/latest.json`, "utf8"));
  ref = { usd: t.btc_usd, source: `tape btc_usd (mempool.space) recorded ${t.recorded_at}` };
}
console.log(`reference: ${ref.usd} (${ref.source})`);

const results: unknown[] = [];
for (const id of ids) {
  const row: Record<string, unknown> = { miner_requested: id };
  try {
    const o = await run({ label: `probe-btc-${id}`, minerId: id, intent: "CRYPTO_PRICE_USD", params: { symbol: "BTC" } });
    const rec = readReceipt(o.receipt_file!);
    const b = rec.response ?? {};
    const v = b.result?.price_usd;
    Object.assign(row, {
      http_status: rec.http_status, paid: rec.paid, miner_id: b.miner_id, miner_name: b.miner_name, endpoint: b.endpoint,
      field_status: b.field_status, price_usd: v ?? null, cost_usd: b.cost_usd, duration_ms: b.duration_ms,
      rel_diff_vs_reference: typeof v === "number" ? (v - ref.usd) / ref.usd : null,
      error: rec.http_status >= 400 ? b : undefined, receipt_file: o.receipt_file,
    });
  } catch (e) { row.error = String(e); }
  results.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync(`${ROOT}data/probe`, { recursive: true });
const file = `data/probe/btc-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(`${ROOT}${file}`, JSON.stringify({ ran_at: new Date().toISOString(), reference: ref, paid_attempts: paidCount(), results }, null, 2));
console.log(`saved ${file}`);
