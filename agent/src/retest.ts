// Retest of Telegraph GRID_POWER_PRICE_GENERAL against CAISO OASIS. At most 3 paid calls (test USDC).
// Writes the exact outcome of each attempt to data/probe/power-retest-<time>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { run, readReceipt, ROOT, paidCount, type Call } from "./x402.js";
import { dayAhead } from "./caiso.js";

const NODE_ID = "TH_SP15_GEN-APND";
const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
const hourIso = hour.toISOString().replace(".000Z", "Z");
const ref = await dayAhead(NODE_ID, hour);
console.log(`CAISO OASIS day-ahead ${NODE_ID} ${ref.interval_start}: ${ref.usd_per_mwh}`);

const q = `What is the CAISO day-ahead locational marginal price in US dollars per MWh for node ${NODE_ID} for the hour starting ${hourIso}?`;
const attempts: Call[] = [
  { label: "retest-router-params", intent: "GRID_POWER_PRICE_GENERAL", params: { node_or_zone: NODE_ID, interval_start: hourIso } },
  { label: "retest-router-query", intent: "GRID_POWER_PRICE_GENERAL", query: q },
  { label: "retest-92881-query", minerId: "92881", intent: "GRID_POWER_PRICE_GENERAL", query: q },
];

const results: unknown[] = [];
for (const c of attempts) {
  const row: Record<string, unknown> = { label: c.label, miner_requested: c.minerId ?? "router", request: { intent: c.intent, params: c.params ?? null, query: c.query ?? null } };
  try {
    const o = await run(c);
    const rec = readReceipt(o.receipt_file!);
    const b = rec.response ?? {};
    Object.assign(row, {
      skipped_existing_receipt: o.skipped ?? null, http_status: rec.http_status, paid: rec.paid,
      miner_id: b.miner_id, miner_name: b.miner_name, endpoint: b.endpoint, result: b.result, field_status: b.field_status,
      cost_usd: b.cost_usd, error: rec.http_status >= 400 ? b : undefined,
      reference_day_ahead: ref.usd_per_mwh,
      abs_diff: typeof b.result?.lmp_usd_per_mwh === "number" ? Math.abs(b.result.lmp_usd_per_mwh - ref.usd_per_mwh) : null,
    });
  } catch (e) { row.error = String(e); }
  results.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync(`${ROOT}data/probe`, { recursive: true });
const file = `data/probe/power-retest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(`${ROOT}${file}`, JSON.stringify({ ran_at: new Date().toISOString(), node: NODE_ID, interval_start: hourIso, caiso_day_ahead: ref, paid_attempts: paidCount(), results }, null, 2));
console.log(`saved ${file}`);
