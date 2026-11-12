// Pure tool logic. The server in index.ts only fetches the published JSON and calls these.
import { decide, selectPower, type MarketTape, type Site } from "@hushrate/core";

export function summarizeMarket(t: MarketTape) {
  return {
    interval_start: t.interval_start,
    recorded_at: t.recorded_at,
    block_height: t.block_height,
    btc_usd: t.btc_usd,
    hashprice: {
      sats_per_ph_day: t.hashprice.value_sats_per_ph_day,
      source: t.hashprice.source,
      label: t.hashprice.label,
      public_144_block_sats_per_ph_day: t.hashprice.public_144?.hashprice_sats_per_ph_day ?? null,
      telegraph_receipt_hash: t.hashprice.telegraph?.receipt_hash ?? null,
      telegraph_tx_hash: t.hashprice.telegraph?.tx_hash ?? null,
    },
    power: t.power.map((p) => {
      const s = selectPower(p);
      return {
        node: p.node,
        used_usd_per_mwh: s.usd_per_mwh,
        basis: s.basis,
        source: s.source,
        real_time_usd_per_mwh: p.real_time_usd_per_mwh,
        day_ahead_usd_per_mwh: p.day_ahead_usd_per_mwh,
      };
    }),
    notes: t.notes,
    degraded: t.degraded ?? [],
  };
}

export interface DecideInput {
  node: string;
  power_mw: number;
  efficiency_j_per_th: number;
  power_adder_usd_per_mwh?: number;
  min_margin_usd_per_day?: number;
  name?: string;
}

export function decideFromTape(t: MarketTape, i: DecideInput) {
  const site: Site = {
    name: i.name ?? "site",
    node: i.node,
    power_mw: i.power_mw,
    efficiency_j_per_th: i.efficiency_j_per_th,
    power_adder_usd_per_mwh: i.power_adder_usd_per_mwh ?? 0,
    min_margin_usd_per_day: i.min_margin_usd_per_day ?? 0,
  };
  const p = t.power.find((x) => x.node === i.node);
  const s = p ? selectPower(p) : { usd_per_mwh: null, basis: null, source: "node not on the tape" };
  const d = decide(site, { power_usd_per_mwh: s.usd_per_mwh, hashprice_sats_per_ph_day: t.hashprice.value_sats_per_ph_day, btc_usd: t.btc_usd });
  return {
    interval_start: t.interval_start,
    decision: d.action,
    reasons: d.reasons,
    margin_usd_per_day: d.margin_usd_per_day ?? null,
    revenue_usd_per_day: d.revenue_usd_per_day ?? null,
    power_cost_usd_per_day: d.power_cost_usd_per_day ?? null,
    breakeven_power_usd_per_mwh: d.breakeven_power_usd_per_mwh ?? null,
    inputs: {
      power_usd_per_mwh: s.usd_per_mwh, power_basis: s.basis, power_source: s.source,
      hashprice_sats_per_ph_day: t.hashprice.value_sats_per_ph_day, hashprice_source: t.hashprice.source, btc_usd: t.btc_usd,
    },
    note: "Testnet-data decision aid. Hushrate holds when any input is missing and never guesses.",
  };
}

export function receiptsView<T extends { at: string }>(rows: T[], limit = 20): T[] {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  return rows.slice(-n).reverse();
}
