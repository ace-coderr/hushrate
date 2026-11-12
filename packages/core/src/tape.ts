// Shape of the hourly market tape. MARKET data only: no site or decision data lives here.
import type { HashpriceWindow } from "./hashprice.js";

export interface TelegraphCall {
  intent: string;
  requested_miner: string | null;
  miner_id?: string | null;
  miner_name?: string | null;
  http_status: number | null;
  paid: boolean;
  cost_usd: number | null;
  field_status?: Record<string, string> | null;
  value: number | null;
  returned_height?: number | null;
  signal_hash?: string | null;
  receipt_hash?: string | null;
  tx_hash?: string | null;
  receipt_file?: string | null;
  accepted: boolean;
  reject_reason?: string | null;
}

export interface PowerPrice {
  node: string;
  day_ahead_usd_per_mwh: number | null;
  day_ahead_interval: string | null;
  real_time_usd_per_mwh: number | null;
  real_time_interval: string | null;
  /** Telegraph answer for this node, when one was bought. Day-ahead basis. */
  telegraph: TelegraphCall | null;
  errors: string[];
}

export interface MarketTape {
  schema: 1;
  interval_start: string;
  recorded_at: string;
  block_height: number | null;
  btc_usd: number | null;
  hashprice: {
    value_sats_per_ph_day: number | null;
    source: "telegraph" | "public" | null;
    label: string;
    public_144: (HashpriceWindow & { tip: number }) | null;
    telegraph: TelegraphCall | null;
    /** Public single-block hashprice at the block height we asked Telegraph about, for a same-block check. */
    public_at_telegraph_height: number | null;
  };
  power: PowerPrice[];
  spend: { paid_calls: number; cost_usd: number };
  wallet_usdc_after: string | null;
  notes: string[];
}

export interface HistoryEntry {
  interval_start: string;
  block_height: number | null;
  btc_usd: number | null;
  hashprice_sats_per_ph_day: number | null;
  hashprice_source: "telegraph" | "public" | null;
  power: { node: string; usd_per_mwh: number | null; basis: PowerBasis | null }[];
  paid_calls: number;
  cost_usd: number;
  tx_hashes: string[];
  receipt_hashes: string[];
}

export type PowerBasis = "real-time" | "day-ahead";

/** Real-time when available, otherwise day-ahead (Telegraph's verified answer first, else CAISO). Never guessed. */
export function selectPower(p: PowerPrice): { usd_per_mwh: number | null; basis: PowerBasis | null; source: string } {
  if (p.real_time_usd_per_mwh !== null) return { usd_per_mwh: p.real_time_usd_per_mwh, basis: "real-time", source: "CAISO OASIS 5-min real-time" };
  if (p.telegraph?.accepted && p.telegraph.value !== null) return { usd_per_mwh: p.telegraph.value, basis: "day-ahead", source: `Telegraph miner ${p.telegraph.miner_id ?? p.telegraph.requested_miner}` };
  if (p.day_ahead_usd_per_mwh !== null) return { usd_per_mwh: p.day_ahead_usd_per_mwh, basis: "day-ahead", source: "CAISO OASIS day-ahead" };
  return { usd_per_mwh: null, basis: null, source: "unavailable" };
}

export function toHistoryEntry(t: MarketTape): HistoryEntry {
  const calls = [t.hashprice.telegraph, ...t.power.map((p) => p.telegraph)].filter((c): c is TelegraphCall => !!c && c.paid);
  return {
    interval_start: t.interval_start,
    block_height: t.block_height,
    btc_usd: t.btc_usd,
    hashprice_sats_per_ph_day: t.hashprice.value_sats_per_ph_day,
    hashprice_source: t.hashprice.source,
    power: t.power.map((p) => { const s = selectPower(p); return { node: p.node, usd_per_mwh: s.usd_per_mwh, basis: s.basis }; }),
    paid_calls: t.spend.paid_calls,
    cost_usd: t.spend.cost_usd,
    tx_hashes: calls.map((c) => c.tx_hash).filter((x): x is string => !!x),
    receipt_hashes: calls.map((c) => c.receipt_hash).filter((x): x is string => !!x),
  };
}
