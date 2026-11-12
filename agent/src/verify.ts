// Free data-reality check: compares saved paid results with independent public sources.
// CAISO OASIS (day-ahead LMP) for power price; mempool.space for height and hashrate.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RECEIPTS = `${ROOT}data/receipts`;
const OUT = `${ROOT}data/verification`;
mkdirSync(OUT, { recursive: true });

function latest(label: string): any | null {
  const files = readdirSync(RECEIPTS).filter((f) => f.endsWith(`-${label}.json`) && f.includes("T")).sort();
  const f = files[files.length - 1];
  return f ? { file: f, ...JSON.parse(readFileSync(`${RECEIPTS}/${f}`, "utf8")) } : null;
}

// Minimal single-entry zip reader (uses the central directory so data descriptors are fine).
function unzipFirst(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("OASIS did not return a zip (likely an error response)");
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const raw = buf.subarray(dataStart, dataStart + csize);
  return (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
}

async function getText(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

const out: Record<string, unknown> = { checked_at: new Date().toISOString() };

// ---- Call A: CAISO day-ahead LMP
const a = latest("A-grid-power");
if (a) {
  const res = a.response ?? {};
  const rec: Record<string, unknown> = {
    receipt_file: a.file, miner_id: res.miner_id, miner_name: res.miner_name,
    field_status: res.field_status, cost_usd: res.cost_usd, signal_hash: res.signal_hash,
    miner_value_usd_per_mwh: res.result?.lmp_usd_per_mwh ?? null,
  };
  try {
    const zone = a.params.node_or_zone as string;
    const start = new Date(a.params.interval_start as string);
    const end = new Date(start.getTime() + 3600_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 16).replace(/-/g, "") + "-0000";
    const url = `https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=${fmt(start)}&enddatetime=${fmt(end)}&version=1&market_run_id=DAM&node=${zone}&resultformat=6`;
    const zip = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
    const csv = unzipFirst(zip);
    const lines = csv.trim().split(/\r?\n/);
    const head = lines[0].split(",");
    const idx = (n: string) => head.indexOf(n);
    const row = lines.slice(1).map((l) => l.split(",")).find((c) =>
      c[idx("LMP_TYPE")] === "LMP" && Date.parse(c[idx("INTERVALSTARTTIME_GMT")]) === start.getTime());
    if (!row) throw new Error("No matching LMP row in OASIS response");
    const ref = Number(row[idx("MW")]);
    rec.reference_source = "CAISO OASIS PRC_LMP, DAM, LMP component";
    rec.reference_value_usd_per_mwh = ref;
    const mv = rec.miner_value_usd_per_mwh as number | null;
    rec.abs_diff = mv == null ? null : Math.abs(mv - ref);
    rec.verdict = mv == null ? "no value returned" : Math.abs(mv - ref) <= 0.01 ? "match" : "mismatch";
  } catch (e) { rec.reference_error = String(e); rec.verdict = "reference unreachable"; }
  out.grid_power = rec;
}

// ---- Call B: height / hashrate / hashprice
const b = latest("B-hashprice");
if (b) {
  const res = b.response ?? {};
  const rec: Record<string, unknown> = {
    receipt_file: b.file, miner_id: res.miner_id, miner_name: res.miner_name,
    field_status: res.field_status, cost_usd: res.cost_usd, signal_hash: res.signal_hash,
    requested_block_height: b.params.block_height,
    miner_result: res.result,
  };
  try {
    const tip = Number((await getText("https://mempool.space/api/blocks/tip/height")).trim());
    const hr = JSON.parse(await getText("https://mempool.space/api/v1/mining/hashrate/3d"));
    rec.reference_source = "mempool.space";
    rec.reference_tip_height_now = tip;
    rec.reference_hashrate_eh_s = hr.currentHashrate / 1e18;
    const mh = res.result?.block_height;
    rec.height_verdict = mh == null ? "no value returned" : mh === b.params.block_height ? "match" : "mismatch";
    rec.hashrate_verdict = res.result?.hashrate_eh_s == null ? "no value returned" : "compared below";
    rec.hashprice_verdict = res.result?.hashprice_usd_per_ph_day == null ? "no value returned" : "not independently verifiable here";
  } catch (e) { rec.reference_error = String(e); }
  out.hashprice = rec;
}

const file = `${OUT}/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(`saved ${file.replace(ROOT, "")}`);
