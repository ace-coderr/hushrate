// Hushrate: one allocation cycle (or an hourly loop) that prints a receipt per decision.
//   tsx src/agent.ts            one cycle, buys hashprice from the pinned Telegraph miner (test USDC)
//   tsx src/agent.ts --no-pay   one cycle using only public sources, spends nothing
//   tsx src/agent.ts --loop     repeat at the top of every UTC hour until the paid-call cap is reached
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decide, type Site } from "./decide.js";
import { oasisDamLmp, blockHashprice, btcUsd, tipHeight } from "./ref.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PINNED_MINER = "71083"; // verified against the public block formula in docs/probe-report.md
const TOLERANCE = 0.01;       // Telegraph hashprice must be within 1% of the public computation
const noPay = process.argv.includes("--no-pay");
const loop = process.argv.includes("--loop");

const sites: Site[] = JSON.parse(readFileSync(`${ROOT}config/sites.json`, "utf8")).sites;

async function cycle(): Promise<void> {
  const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
  const hourIso = hour.toISOString().replace(".000Z", "Z");
  const notes: string[] = [];

  // Public inputs. If any is unavailable we make no decision rather than guess.
  let height: number, ref: Awaited<ReturnType<typeof blockHashprice>>, price: number;
  try { height = await tipHeight(); ref = await blockHashprice(height); price = await btcUsd(); }
  catch (e) { console.error(`NO DECISION: public market inputs unavailable (${e})`); return; }

  // Hashprice: buy from the pinned Telegraph miner, accept only if it verifies.
  let hashprice = ref.hashprice_sats_per_ph_day;
  let hashpriceSource = "public (mempool.space block formula)";
  let telegraph: Record<string, unknown> | null = null;
  if (!noPay) {
    const x = await import("./x402.js");
    try {
      const o = await x.run({ label: `agent-hashprice-${height}`, minerId: PINNED_MINER, intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: height } });
      if (o.skipped) {
        notes.push(`already bought for block ${height} (${o.skipped}); using public value`);
        telegraph = { skipped_existing_receipt: o.skipped };
      } else {
        const b = o.body ?? {};
        const v = b.result?.hashprice_sats_per_ph_day as number | null | undefined;
        const ok = o.status === 200 && b.field_status?.hashprice_sats_per_ph_day === "ok" && b.result?.block_height === height;
        const rel = typeof v === "number" ? Math.abs(v - ref.hashprice_sats_per_ph_day) / ref.hashprice_sats_per_ph_day : null;
        telegraph = { http_status: o.status, paid: o.paid, receipt_file: o.file, miner_id: b.miner_id, field_status: b.field_status,
          value_sats_per_ph_day: v ?? null, rel_diff_vs_public: rel, signal_hash: b.signal_hash, error: o.status && o.status >= 400 ? b.error : undefined };
        if (ok && rel !== null && rel <= TOLERANCE) {
          hashprice = v as number; hashpriceSource = `telegraph miner ${PINNED_MINER} (verified within ${TOLERANCE * 100}% of public)`;
        } else {
          notes.push(`Telegraph hashprice rejected (status ${o.status}, diff ${rel}); fell back to public value`);
        }
      }
    } catch (e) { notes.push(`Telegraph call failed: ${e}; fell back to public value`); }
  }

  // Power price per node: CAISO OASIS day-ahead LMP for this hour.
  const lmp = new Map<string, number | string>();
  for (const node of new Set(sites.map((s) => s.caiso_node))) {
    try { lmp.set(node, await oasisDamLmp(node, hourIso)); } catch (e) { lmp.set(node, String(e)); }
    await new Promise((r) => setTimeout(r, 5500)); // OASIS asks for >=5 s between requests
  }

  const decisions = sites.map((site) => {
    const p = lmp.get(site.caiso_node);
    if (typeof p !== "number") return { site: site.name, node: site.caiso_node, action: "HOLD (no power price)", error: p };
    return { site: site.name, node: site.caiso_node, lmp_usd_per_mwh: p, ...decide(site, { lmp_usd_per_mwh: p, hashprice_sats_per_ph_day: hashprice, btc_usd: price }) };
  });

  const receipt = {
    agent: "hushrate", interval_start: hourIso, decided_at: new Date().toISOString(),
    inputs: { block_height: height, btc_usd: price, hashprice_sats_per_ph_day: hashprice, hashprice_source: hashpriceSource,
      power_source: "CAISO OASIS PRC_LMP day-ahead (public)" },
    telegraph, notes, sites: sites, decisions,
  };
  mkdirSync(`${ROOT}data/decisions`, { recursive: true });
  const file = `data/decisions/${hourIso.replace(/[:]/g, "-")}.json`;
  writeFileSync(`${ROOT}${file}`, JSON.stringify(receipt, null, 2));

  console.log(`\n=== HUSHRATE RECEIPT  interval ${hourIso} ===`);
  console.log(`block ${height} | BTC $${price} | hashprice ${hashprice.toFixed(1)} sats/PH/day via ${hashpriceSource}`);
  for (const n of notes) console.log(`note: ${n}`);
  for (const d of decisions as any[]) {
    if (d.error) { console.log(`${d.site} [${d.node}] ${d.action}: ${d.error}`); continue; }
    console.log(`${d.site} [${d.node}] LMP $${d.lmp_usd_per_mwh.toFixed(2)}/MWh -> ${d.action}  revenue $${d.revenue_usd_per_day.toFixed(0)}/d, power $${d.power_cost_usd_per_day.toFixed(0)}/d, margin $${d.margin_usd_per_day.toFixed(0)}/d, breakeven LMP $${d.breakeven_lmp_usd_per_mwh.toFixed(2)}`);
  }
  console.log(`saved ${file}`);
}

await cycle();
while (loop) {
  const next = new Date(); next.setUTCMinutes(0, 5, 0); next.setUTCHours(next.getUTCHours() + 1);
  console.log(`next cycle at ${next.toISOString()}`);
  await new Promise((r) => setTimeout(r, next.getTime() - Date.now()));
  try { await cycle(); } catch (e) { console.error(`cycle failed: ${e}`); if (String(e).includes("Per-run limit")) break; }
}
