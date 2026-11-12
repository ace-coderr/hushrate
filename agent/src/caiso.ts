// CAISO OASIS public prices (no key). Day-ahead hourly and real-time 5-minute LMP, per node.
import { inflateRawSync } from "node:zlib";

/** Minimal single-entry zip reader (uses the central directory so data descriptors are fine). */
function unzipFirst(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip (likely an OASIS error response)");
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const raw = buf.subarray(dataStart, dataStart + csize);
  return (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/-/g, "") + "-0000";

async function oasisRows(query: string): Promise<{ head: string[]; rows: string[][] }> {
  const res = await fetch(`https://oasis.caiso.com/oasisapi/SingleZip?${query}&resultformat=6`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`OASIS HTTP ${res.status}`);
  const lines = unzipFirst(Buffer.from(await res.arrayBuffer())).trim().split(/\r?\n/);
  const head = lines[0].split(",");
  return { head, rows: lines.slice(1).map((l) => l.split(",")) };
}

export interface PricePoint { usd_per_mwh: number; interval_start: string; }

/** Day-ahead LMP for the hour starting at `hourStart`. Throws if CAISO has no row. */
export async function dayAhead(node: string, hourStart: Date): Promise<PricePoint> {
  const end = new Date(hourStart.getTime() + 3600_000);
  const { head, rows } = await oasisRows(`queryname=PRC_LMP&startdatetime=${stamp(hourStart)}&enddatetime=${stamp(end)}&version=1&market_run_id=DAM&node=${node}`);
  const i = (n: string) => head.indexOf(n);
  const row = rows.find((c) => c[i("LMP_TYPE")] === "LMP" && Date.parse(c[i("INTERVALSTARTTIME_GMT")]) === hourStart.getTime());
  if (!row) throw new Error(`no day-ahead LMP row for ${node} at ${hourStart.toISOString()}`);
  return { usd_per_mwh: Number(row[i("MW")]), interval_start: new Date(Date.parse(row[i("INTERVALSTARTTIME_GMT")])).toISOString() };
}

const MAX_RT_AGE_MS = 90 * 60_000;

/** Latest published real-time 5-minute LMP. Throws if none, or if the newest is older than 90 minutes. */
export async function realTime(node: string, now: Date): Promise<PricePoint> {
  const start = new Date(now.getTime() - 3 * 3600_000);
  const { head, rows } = await oasisRows(`queryname=PRC_INTVL_LMP&startdatetime=${stamp(start)}&enddatetime=${stamp(now)}&version=1&market_run_id=RTM&node=${node}`);
  const i = (n: string) => head.indexOf(n);
  const lmp = rows.filter((c) => c[i("LMP_TYPE")] === "LMP").map((c) => ({ t: Date.parse(c[i("INTERVALSTARTTIME_GMT")]), v: Number(c[i("MW")]) }));
  if (!lmp.length) throw new Error(`no real-time LMP rows for ${node}`);
  const last = lmp.reduce((a, b) => (b.t > a.t ? b : a));
  if (now.getTime() - last.t > MAX_RT_AGE_MS) throw new Error(`real-time LMP stale: newest interval ${new Date(last.t).toISOString()}`);
  return { usd_per_mwh: last.v, interval_start: new Date(last.t).toISOString() };
}
