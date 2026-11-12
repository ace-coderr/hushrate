// Samples specific miners directly (POST /engine/v1/ask/{minerId}) and checks each answer
// against an independent public source. Test USDC only; at most MAX_PAID_CALLS payments.
import { mkdirSync, writeFileSync } from "node:fs";
import { run, paidCount, ROOT, MAX_PAID_CALLS, MAX_PER_PAYMENT, type Call } from "./x402.js";
import { balances } from "./wallet.js";
import { oasisDamLmp, blockHashprice, networkHashrateEh } from "./ref.js";

const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
const hourIso = hour.toISOString().replace(".000Z", "Z");
const tip = Number((await (await fetch("https://mempool.space/api/blocks/tip/height")).text()).trim());
if (!Number.isInteger(tip) || tip <= 0) throw new Error("Invalid block height from mempool.space");
const NP15 = "TH_NP15_GEN-APND";

const calls: Call[] = [
  { label: "S1-caiso-92881", minerId: "92881", intent: "GRID_POWER_PRICE_GENERAL", params: { node_or_zone: NP15, interval_start: hourIso } },
  { label: "S2-caiso-93133", minerId: "93133", intent: "GRID_POWER_PRICE_GENERAL", params: { node_or_zone: NP15, interval_start: hourIso } },
  { label: "S3-hashprice-71083", minerId: "71083", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: tip } },
  { label: "S4-hashprice-4283", minerId: "4283", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: tip } },
];
if (calls.length > MAX_PAID_CALLS) throw new Error("Too many sample calls for the per-run cap");

console.log("Cost table (Ethereum Sepolia, test USDC, no real money)");
console.log("  call                    miner     price/call     cap/payment");
for (const c of calls) console.log(`  ${c.label.padEnd(23)} ${String(c.minerId).padEnd(9)} $0.01 (10000)  $0.03 (${MAX_PER_PAYMENT})`);
console.log(`  worst-case spend this run: $${(0.01 * calls.length).toFixed(2)} (cap ${MAX_PAID_CALLS} paid calls)`);
const before = await balances();
console.log(`  wallet before: ${before.eth} ETH, ${before.usdc} USDC`);
if (Number(before.usdcRaw) < 10000 * calls.length) throw new Error("Insufficient test USDC");

// Reference values, fetched once. Failures are recorded, never filled in.
const ref: Record<string, unknown> = {};
try { ref.caiso_dam_lmp_np15 = await oasisDamLmp(NP15, hourIso); } catch (e) { ref.caiso_error = String(e); }
try { ref.block = { height: tip, ...(await blockHashprice(tip)) }; } catch (e) { ref.block_error = String(e); }
try { ref.network_hashrate_eh_s = await networkHashrateEh(); } catch (e) { ref.hashrate_error = String(e); }
console.log("reference:", JSON.stringify(ref));

const results: unknown[] = [];
for (const c of calls) {
  const row: Record<string, unknown> = { label: c.label, miner_id: c.minerId, intent: c.intent, params: c.params };
  try {
    const o = await run(c);
    if (o.skipped) { row.skipped_existing_receipt = o.skipped; results.push(row); continue; }
    const b = o.body ?? {};
    Object.assign(row, {
      http_status: o.status, paid: o.paid, receipt_file: o.file, miner_name: b.miner_name,
      result: b.result, field_status: b.field_status, cost_usd: b.cost_usd, signal_hash: b.signal_hash,
      error: o.status && o.status >= 400 ? b : undefined,
    });
    if (o.status === 200 && b.result) {
      if (c.intent.startsWith("GRID")) {
        const v = b.result.lmp_usd_per_mwh as number | null;
        const r = ref.caiso_dam_lmp_np15 as number | undefined;
        row.verdict = v == null ? "no value" : r == null ? "reference unavailable" : Math.abs(v - r) <= 0.01 ? "match" : "mismatch";
        row.reference = r; row.diff = v != null && r != null ? v - r : null;
      } else {
        const v = b.result.hashprice_sats_per_ph_day as number | null;
        const r = (ref.block as any)?.hashprice_sats_per_ph_day as number | undefined;
        // 1% tolerance: miners may round or use a slightly different fee convention.
        row.verdict = v == null ? "no value" : r == null ? "reference unavailable" : Math.abs(v - r) / r <= 0.01 ? "match (within 1%)" : "mismatch";
        row.reference = r; row.rel_diff = v != null && r ? (v - r) / r : null;
        row.returned_block_height = b.result.block_height;
        row.hashrate_eh_s = b.result.hashrate_eh_s;
      }
    }
  } catch (e) { row.error = String(e); }
  results.push(row);
  console.log(JSON.stringify(row));
}

const after = await balances();
const out = { checked_at: new Date().toISOString(), reference: ref, results, paid_attempts: paidCount(), wallet_before_usdc: before.usdc, wallet_after_usdc: after.usdc };
mkdirSync(`${ROOT}data/verification`, { recursive: true });
const file = `data/verification/sample-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(`${ROOT}${file}`, JSON.stringify(out, null, 2));
console.log(`wallet after: ${after.eth} ETH, ${after.usdc} USDC (paid attempts: ${paidCount()}); saved ${file}`);
