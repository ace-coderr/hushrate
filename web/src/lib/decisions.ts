import { decide, selectPower, type Site, type Decision, type MarketTape, type HistoryEntry, type PowerBasis } from "@hushrate/core";

export interface Market {
  power_usd_per_mwh: number | null;
  basis: PowerBasis | null;
  source: string;
  hashprice_sats_per_ph_day: number | null;
  btc_usd: number | null;
}

/** Market inputs for one node from the latest tape. Missing node or value stays null (and decides HOLD). */
export function marketFromTape(t: MarketTape, node: string): Market {
  const p = t.power.find((x) => x.node === node);
  const s = p ? selectPower(p) : { usd_per_mwh: null, basis: null, source: "node not on the tape" };
  return { power_usd_per_mwh: s.usd_per_mwh, basis: s.basis, source: s.source, hashprice_sats_per_ph_day: t.hashprice.value_sats_per_ph_day, btc_usd: t.btc_usd };
}

export function marketFromEntry(e: HistoryEntry, node: string): Market {
  const p = e.power.find((x) => x.node === node);
  return { power_usd_per_mwh: p?.usd_per_mwh ?? null, basis: p?.basis ?? null, source: p ? "tape" : "node not on the tape", hashprice_sats_per_ph_day: e.hashprice_sats_per_ph_day, btc_usd: e.btc_usd };
}

export const decideWith = (site: Site, m: Market): Decision => decide(site, m);

export interface Slot { hour: string; entry: HistoryEntry | null; }

/** The last `n` UTC hours ending at the current hour, each matched to a tape entry or null. Gaps stay gaps. */
export function hourSlots(history: HistoryEntry[], n = 24, now = new Date()): Slot[] {
  const end = new Date(now); end.setUTCMinutes(0, 0, 0);
  const byHour = new Map(history.map((h) => [new Date(h.interval_start).getTime(), h]));
  const out: Slot[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = end.getTime() - i * 3600_000;
    out.push({ hour: new Date(t).toISOString(), entry: byHour.get(t) ?? null });
  }
  return out;
}
