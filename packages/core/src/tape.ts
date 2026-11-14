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
    /**
     * What the Telegraph value was checked against. "single_block_at_returned_height": the public hashprice of the one block
     * the miner returned, which is the quantity the miner computes. Absent or "public_144_mean": tapes recorded before
     * 2026-11-14 compared it with the public 144-block mean, a different quantity (see docs/hashprice-drift.md).
     */
    comparison?: "single_block_at_returned_height" | "public_144_mean";
    /** The relative tolerance applied, so a re-check uses the same limit. */
    tolerance_rel?: number;
    /** Which pinned miner produced the accepted or rejected value. */
    miner_role?: "primary" | "fallback" | null;
  };
  /**
   * The BTC/USD price used for decisions. Absent on tapes recorded before the second paid intent existed: those used the
   * public mempool.space price only, and btc_usd carries it.
   */
  btc?: {
    value_usd: number | null;
    source: "telegraph" | "public" | null;
    label: string;
    /** mempool.space price at record time, the reference the bought price is checked against. */
    public_usd: number | null;
    /** The relative tolerance the agent applied (from config), so a re-check uses the same limit. */
    tolerance_rel?: number;
    telegraph: TelegraphCall | null;
  };
  power: PowerPrice[];
  spend: { paid_calls: number; cost_usd: number };
  wallet_usdc_after: string | null;
  notes: string[];
  /** Upstream sources that failed this run (mempool.space, CAISO, Telegraph, Sepolia RPC). Empty or absent when clean. */
  degraded?: string[];
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
  /** Which purchases settled this hour: absent on old entries (they only ever bought hashprice). */
  paid_kinds?: PurchaseKind[];
  btc_source?: "telegraph" | "public" | null;
}

export type PurchaseKind = "hashprice" | "btc";

/** Completeness of a tape or history entry: used to stop a degraded rerun from overwriting a better tape for the same hour. */
export function tapeScore(t: { hashprice: number | null; btc: number | null; powerNodesWithPrice: number }): number {
  return (t.hashprice !== null ? 1 : 0) + (t.btc !== null ? 1 : 0) + t.powerNodesWithPrice;
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
  const calls = [t.hashprice.telegraph, t.btc?.telegraph ?? null, ...t.power.map((p) => p.telegraph)].filter((c): c is TelegraphCall => !!c && c.paid);
  const paid_kinds: PurchaseKind[] = [];
  if (t.hashprice.telegraph?.paid) paid_kinds.push("hashprice");
  if (t.btc?.telegraph?.paid) paid_kinds.push("btc");
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
    paid_kinds,
    btc_source: t.btc ? t.btc.source : "public",
  };
}

/**
 * The acceptance rule for the bought BTC/USD price. Shared by the agent, the Proof page and the tests so they cannot
 * disagree. Accepted only when the call succeeded, the used field is `ok`, and the value is within `tolerance`
 * (relative, e.g. 0.005 = 0.5%) of the public price. Otherwise the public price is used and `reason` says why.
 */
export function checkBtcPurchase(
  call: { http_status: number | null; field_status?: Record<string, string> | null; value: number | null; reject_reason?: string | null },
  publicUsd: number | null,
  tolerance: number,
): { accepted: boolean; reason: string | null; rel: number | null } {
  const rel = call.value !== null && publicUsd !== null && publicUsd > 0 ? Math.abs(call.value - publicUsd) / publicUsd : null;
  let reason: string | null = null;
  if (call.reject_reason) reason = call.reject_reason;
  else if (call.http_status !== 200) reason = `HTTP ${call.http_status}`;
  else if (call.field_status?.price_usd !== "ok") reason = `field not ok: price_usd is ${call.field_status?.price_usd ?? "absent"}`;
  else if (publicUsd === null) reason = "no public BTC/USD price to verify against";
  else if (rel === null) reason = "no value";
  else if (rel > tolerance) reason = `differs ${(rel * 100).toFixed(2)}% from the public BTC/USD price (limit ${tolerance * 100}%)`;
  return { accepted: reason === null, reason, rel };
}

export const HASHPRICE_REQUIRED_FIELDS = ["hashprice_sats_per_ph_day", "block_height", "hashrate_eh_s"] as const;

/**
 * The acceptance rule for a bought hashprice. Shared by the agent, the Proof page and the tests.
 * Accepted only when the call succeeded, the fields the agent uses are ok, the miner answered for the block that was
 * requested (not a stale one), and the value is within `tolerance` of `publicValue`. For tapes from 2026-11-14 on,
 * `publicValue` is the public single-block hashprice at the returned height, the same quantity the miner computes.
 * The tolerance is never widened to make a value pass.
 */
export function checkHashpricePurchase(
  call: { http_status: number | null; field_status?: Record<string, string> | null; value: number | null; returned_height?: number | null; reject_reason?: string | null },
  requestedHeight: number | null,
  publicValue: number | null,
  tolerance: number,
): { accepted: boolean; reason: string | null; rel: number | null } {
  const rel = call.value !== null && publicValue !== null && publicValue > 0 ? Math.abs(call.value - publicValue) / publicValue : null;
  const bad = HASHPRICE_REQUIRED_FIELDS.filter((k) => call.field_status?.[k] !== "ok");
  let reason: string | null = null;
  if (call.reject_reason) reason = call.reject_reason;
  else if (call.http_status !== 200) reason = `HTTP ${call.http_status}`;
  else if (bad.length) reason = `field not ok: ${bad.join(", ")}`;
  else if (requestedHeight !== null && call.returned_height !== requestedHeight) reason = `stale height: miner answered for block ${call.returned_height}, requested ${requestedHeight}`;
  else if (publicValue === null) reason = "no public value to verify against";
  else if (rel === null) reason = "no value";
  else if (rel > tolerance) reason = `differs ${(rel * 100).toFixed(2)}% from the public single-block value at the returned height (limit ${tolerance * 100}%)`;
  return { accepted: reason === null, reason, rel };
}

/**
 * May the fallback miner be tried after the primary? Only if the primary did NOT sign a payment (a miner that was
 * removed, or refused the request before payment). If a payment was signed it may have settled, so we never pay a
 * second time for the same intent in the same hour.
 */
export const mayTryFallback = (primary: { paid: boolean }) => !primary.paid;
