// Independent public reference sources (free, no key).
import { inflateRawSync } from "node:zlib";

/** Minimal single-entry zip reader (uses the central directory so data descriptors are fine). */
export function unzipFirst(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip (likely an error response)");
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const raw = buf.subarray(dataStart, dataStart + csize);
  return (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/** CAISO OASIS day-ahead LMP (USD/MWh) for one node and hour. Throws if unavailable. */
export async function oasisDamLmp(node: string, startIso: string): Promise<number> {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 3600_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace(/-/g, "") + "-0000";
  const url = `https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=${fmt(start)}&enddatetime=${fmt(end)}&version=1&market_run_id=DAM&node=${node}&resultformat=6`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const csv = unzipFirst(Buffer.from(await res.arrayBuffer())).trim().split(/\r?\n/);
  const head = csv[0].split(",");
  const i = (n: string) => head.indexOf(n);
  const row = csv.slice(1).map((l) => l.split(",")).find((c) =>
    c[i("LMP_TYPE")] === "LMP" && Date.parse(c[i("INTERVALSTARTTIME_GMT")]) === start.getTime());
  if (!row) throw new Error(`no OASIS DAM LMP row for ${node} at ${startIso}`);
  return Number(row[i("MW")]);
}

/**
 * Gross expected hashprice at one block, from that block's own reward (subsidy + fees) and difficulty:
 * sats per PH/s per day = reward_sats * 1e15 * 86400 / (difficulty * 2^32).
 */
export async function blockHashprice(height: number) {
  const hash = (await (await fetch(`https://mempool.space/api/block-height/${height}`)).text()).trim();
  const blk = await getJson(`https://mempool.space/api/v1/block/${hash}`);
  const reward: number = blk.extras.reward;
  const difficulty: number = blk.difficulty;
  const sats = (reward * 1e15 * 86400) / (difficulty * 2 ** 32);
  return { block_hash: hash, reward_sats: reward, difficulty, hashprice_sats_per_ph_day: sats };
}

export async function networkHashrateEh(): Promise<number> {
  return (await getJson("https://mempool.space/api/v1/mining/hashrate/3d")).currentHashrate / 1e18;
}
