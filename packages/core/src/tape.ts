// Shape of the hourly market tape. MARKET data only: no site or decision data lives here.
import type { HashpriceWindow } from "./hashprice.js";

/**
 * Did money move? TelegraphCall.paid means a payment was SIGNED and sent. If the node then answered HTTP 402 ("verified but
 * could not be settled", e.g. a facilitator timeout) nothing settled. A settled payment answers 200, or an error status after
 * settlement (the node credits those back to escrow). Accounting, history and the paid-data banner count settled payments only;
 * the fallback rule still uses "signed", because an unsettled authorization must not be followed by a second payment.
 */
export const isSettled = (c: { paid: boolean; http_status: number | null }) => c.paid && c.http_status !== 402;

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
  /**
   * The payment asset this run was allowed to pay with (pinned in config/networks.json). Absent on tapes recorded before
   * 2026-11-17: those were paid in the previous test USDC, LEGACY_PAYMENT_ASSET.
   */
  payment?: {
    /** The asset this run paid (or would pay) in: the one the node's 402 asked for, when it could be read. */
    asset: string;
    network: string;
    pay_to: string;
    /** What the node's 402 asked for this run (null when the challenge could not be read or no call was needed). */
    requested?: string | null;
    /** The allow-list in force: the only assets Hushrate pays. */
    allowed?: string[];
  };
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
  const calls = [t.hashprice.telegraph, t.btc?.telegraph ?? null, ...t.power.map((p) => p.telegraph)].filter((c): c is TelegraphCall => !!c && isSettled(c));
  const paid_kinds: PurchaseKind[] = [];
  if (t.hashprice.telegraph && isSettled(t.hashprice.telegraph)) paid_kinds.push("hashprice");
  if (t.btc?.telegraph && isSettled(t.btc.telegraph)) paid_kinds.push("btc");
  return {
    interval_start: t.interval_start,
    block_height: t.block_height,
    btc_usd: t.btc_usd,
    hashprice_sats_per_ph_day: t.hashprice.value_sats_per_ph_day,
    hashprice_source: t.hashprice.source,
    power: t.power.map((p) => { const s = selectPower(p); return { node: p.node, usd_per_mwh: s.usd_per_mwh, basis: s.basis }; }),
    // Settled calls recorded on the tape itself (a signed-but-unsettled payment is not a purchase).
    paid_calls: calls.length,
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

// ---- payment asset ------------------------------------------------------------------------------------------------

/**
 * The test USDC Telegraph accepted until 2026-11-17 07:00 UTC. Tapes, receipts and ledger rows written before the asset
 * was recorded carry no asset field and are treated as this one.
 */
export const LEGACY_PAYMENT_ASSET = "0xcc194e1a843B658526D0D5C431f670028582Ae17";

/** The asset a tape, receipt or ledger row was paid in: its recorded asset, or the legacy one when none was recorded. */
export const paymentAssetOf = (x?: { asset?: string | null; payment?: { asset?: string | null } | null } | null): string =>
  x?.asset ?? x?.payment?.asset ?? LEGACY_PAYMENT_ASSET;

export const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface PaymentChallengeOption { scheme?: string; network?: string; asset?: string; amount?: string; payTo?: string; }

/** One allowed payment: an exact (network, asset, payee) triple. Hushrate pays only the entries of an explicit allow-list. */
export interface PaymentPin { network: string; asset: string; payTo: string; symbol?: string; decimals?: number; }

/**
 * Is this payment requirement one Hushrate is allowed to pay? Scheme "exact" and an exact (network, asset, payee) match
 * with one entry of the allow-list. Used by the payment client's policy and by the tests, so the rule cannot drift from
 * what is enforced. An unknown asset, a known asset to a different payee, another network, or the escrow scheme: refused.
 */
export function isAllowedPayment(opt: PaymentChallengeOption, pins: PaymentPin[]): boolean {
  return opt.scheme === "exact" && pins.some((p) => opt.network === p.network && sameAddress(opt.asset, p.asset) && sameAddress(opt.payTo, p.payTo));
}

/** The first option of a challenge that is allowed, with the pin it matched (that is what the payment client will pay). */
export function selectPayment(challenge: PaymentChallengeOption[] | null, pins: PaymentPin[]): { option: PaymentChallengeOption; pin: PaymentPin } | null {
  for (const o of challenge ?? []) {
    const pin = pins.find((p) => o.scheme === "exact" && o.network === p.network && sameAddress(o.asset, p.asset) && sameAddress(o.payTo, p.payTo));
    if (pin) return { option: o, pin };
  }
  return null;
}

/**
 * A loud, specific reason for a refused payment: what the miner asked for (asset and network) against the allow-list.
 * Options without an asset (the escrow scheme) are not listed as assets.
 */
export function describeRefusal(challenge: PaymentChallengeOption[] | null, pins: PaymentPin[]): string {
  const want = (challenge ?? []).filter((o) => o.asset);
  const asked = want.length
    ? want.map((o) => `${o.scheme ?? "?"} asset ${o.asset} on ${o.network ?? "?"} (payTo ${o.payTo ?? "?"}, amount ${o.amount ?? "?"})`).join("; ")
    : "no payment option could be read from the challenge";
  const allowed = pins.map((p) => `${p.asset} on ${p.network} to ${p.payTo}`).join("; ");
  const networks = new Set(pins.map((p) => p.network));
  const onNet = want.filter((o) => o.network && networks.has(o.network));
  let why = "";
  if (want.length && !onNet.length) why = ` None is on ${[...networks].join(" or ")}.`;
  else if (onNet.length && onNet.every((o) => !pins.some((p) => sameAddress(o.asset, p.asset)))) why = " The asset on the allowed network is not on the allow-list.";
  else if (onNet.length && !selectPayment(onNet, pins)) why = " The asset is allowed but the payee (payTo) is not the one pinned for it.";
  return `payment refused by spend controls: the miner asked for ${asked}. Hushrate only pays: ${allowed}.${why}`;
}

/** Can the wallet pay for this run? Compares the balance of the PINNED asset (in base units) with the run's cost. */
export function fundingStatus(balanceUnits: bigint | null, runCostUnits: bigint): { funded: boolean; reason: string | null } {
  if (balanceUnits === null) return { funded: false, reason: "the wallet balance could not be read" };
  if (balanceUnits < runCostUnits) return { funded: false, reason: "balance below the cost of the run" };
  return { funded: true, reason: null };
}

export type PaymentAssessment =
  | { state: "ok"; pin: PaymentPin; balanceUnits: bigint }
  | { state: "refused"; reason: string }
  | { state: "unfunded"; pin: PaymentPin; balanceUnits: bigint; reason: string }
  | { state: "unreadable"; reason: string };

/**
 * Decide, before any miner is paid: what did the node's 402 ask for, is that on the allow-list, and does the wallet hold
 * enough of THAT asset for the run? The balance of the other allowed asset is irrelevant: the node, not us, picks the asset.
 *  - refused:    the requested asset or payee is not allowed (loud reason naming asset and network)
 *  - unfunded:   allowed, but the balance of the requested asset is below the run's cost ("unfunded for <asset>")
 *  - unreadable: no challenge, or the wallet balance could not be read
 */
export function assessPayment(
  challenge: PaymentChallengeOption[] | null,
  pins: PaymentPin[],
  balances: Record<string, bigint | null>,
  runCostUnits: bigint,
): PaymentAssessment {
  if (!challenge || !challenge.length) return { state: "unreadable", reason: "the node's payment terms (402 challenge) could not be read" };
  const sel = selectPayment(challenge, pins);
  if (!sel) return { state: "refused", reason: describeRefusal(challenge, pins) };
  const bal = balances[sel.pin.asset.toLowerCase()] ?? null;
  const f = fundingStatus(bal, runCostUnits);
  if (bal === null) return { state: "unreadable", reason: `the wallet balance of ${sel.pin.asset} could not be read` };
  if (!f.funded) {
    const dec = sel.pin.decimals ?? 6;
    return { state: "unfunded", pin: sel.pin, balanceUnits: bal, reason: `unfunded for ${sel.pin.symbol ?? "token"} ${sel.pin.asset} on ${sel.pin.network}: balance ${Number(bal) / 10 ** dec}, this run costs ${Number(runCostUnits) / 10 ** dec}` };
  }
  return { state: "ok", pin: sel.pin, balanceUnits: bal };
}

// ---- paid-data health (the "Paid data paused" banner) -------------------------------------------------------------------

export interface PaidDataHealth {
  /** Trailing hourly tapes, newest first, that bought nothing. */
  consecutiveMisses: number;
  /** True when 2 or more of the most recent hourly tapes in a row bought nothing. */
  paused: boolean;
  /** Hourly tapes in the last 24 hours that were public-only (nothing bought), and how many tapes there were. */
  publicOnlyHours24: number;
  tapes24: number;
  lastPaidHour: string | null;
}

/**
 * Derived from the hourly history only. A tape "bought nothing" when it settled no paid call. Two in a row means the
 * paid data is paused: decisions are running on labelled public values.
 */
export function paidDataHealth(history: Pick<HistoryEntry, "interval_start" | "paid_calls">[], now: Date = new Date()): PaidDataHealth {
  const sorted = [...history].sort((a, b) => a.interval_start.localeCompare(b.interval_start));
  let misses = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].paid_calls === 0; i--) misses++;
  const cutoff = now.getTime() - 24 * 3600_000;
  const recent = sorted.filter((h) => new Date(h.interval_start).getTime() > cutoff);
  const lastPaid = [...sorted].reverse().find((h) => h.paid_calls > 0);
  return {
    consecutiveMisses: misses,
    paused: misses >= 2,
    publicOnlyHours24: recent.filter((h) => h.paid_calls === 0).length,
    tapes24: recent.length,
    lastPaidHour: lastPaid ? lastPaid.interval_start : null,
  };
}
