// Telegraph's escrow rail, as pure functions (no network, no key) so every rule can be tested.
//
// Escrow is one more entry in the same x402 `accepts` array. The wallet deposits USDC once (LedgerFacet.depositUSDC), then each
// call is authorised by an EIP-191 personal_sign over a message template the node supplies, sent in the X-PAYMENT header. There is
// no facilitator and no per-request on-chain transaction, so a served call has a receipt_hash and an epoch, never a tx_hash.
// Source: https://anjoman.ai/docs/using/escrow-inference, confirmed against the live 402 challenges (data/probe/escrow-*.json).

export type Rail = "escrow" | "exact";

/** What Hushrate will pay on the escrow rail: exactly this network and this Diamond. Nothing else. */
export interface EscrowPin { network: string; diamond: string; }

export interface EscrowOption {
  scheme?: string; network?: string; payTo?: string; amount?: string; price?: string;
  extra?: { message?: string; resource?: string; signWith?: string; description?: string };
}

/** The node enforces at most 2 minutes between validAfter and validBefore; Hushrate signs 90 seconds. */
export const ESCROW_MAX_WINDOW_SECONDS = 120;
export const ESCROW_WINDOW_SECONDS = 90;
/** validAfter is set slightly in the past so a small clock difference with the node cannot make the window "not valid yet". */
export const ESCROW_BACKDATE_SECONDS = 5;

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** The figure in the `Amount: N uUSDC` line of the template: the reliable place to read the amount to authorise. */
export function escrowAmountOf(message: string | null | undefined): bigint | null {
  const m = /Amount:\s*(\d+)\s*uUSDC/.exec(message ?? "");
  return m ? BigInt(m[1]) : null;
}

/** "$0.01" -> 10000n micro-USDC; anything else -> null. */
export function priceToUnits(price: string | null | undefined): bigint | null {
  const m = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec((price ?? "").trim());
  return m ? BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0") : null;
}

export type EscrowOffer =
  | { state: "absent" }
  | { state: "refused"; reason: string }
  | { state: "ok"; option: EscrowOption; amount: bigint; template: string; to: string };

/**
 * Look for the escrow entry in a 402 challenge and hold it to the pins. Refuses (loudly, with the reason) any other network or
 * payee, a template that does not name the pinned payee, network and resource, an amount that differs between the quote and the
 * template, or an amount above the per-payment cap. `resource` is the path inside the engine (for example /v1/ask/7320).
 */
export function checkEscrowOffer(accepts: EscrowOption[] | null | undefined, pin: EscrowPin, capUnits: bigint, resource?: string): EscrowOffer {
  const options = (accepts ?? []).filter((o) => o.scheme === "escrow");
  if (options.length === 0) return { state: "absent" };
  const refuse = (reason: string): EscrowOffer => ({ state: "refused", reason: `escrow terms refused: ${reason}` });
  // Several escrow entries could exist; the first that satisfies every pin wins, and if none does the first one's reason is reported.
  let firstReason: string | null = null;
  for (const o of options) {
    const bad = (() => {
      if (o.network !== pin.network) return `network ${o.network ?? "missing"} is not the pinned ${pin.network}`;
      if (lc(o.payTo) !== lc(pin.diamond)) return `payTo ${o.payTo ?? "missing"} is not the pinned Diamond ${pin.diamond}`;
      const t = o.extra?.message;
      if (!t) return "the challenge carries no message template to sign";
      for (const ph of ["{from}", "{nonce}", "{validAfter}", "{validBefore}"]) if (!t.includes(ph)) return `the template has no ${ph} placeholder`;
      if (!t.includes(`Pay To: ${lc(pin.diamond)}`)) return "the template does not name the pinned Diamond as the payee";
      if (!t.includes(`Network: ${pin.network}`)) return `the template does not name the network ${pin.network}`;
      if (resource && !t.includes(`Resource: ${resource}\n`)) return `the template is for a different resource than ${resource}`;
      const inMessage = escrowAmountOf(t);
      if (inMessage === null) return "the template has no readable Amount line";
      const quoted = o.amount !== undefined ? (/^\d+$/.test(o.amount) ? BigInt(o.amount) : null) : priceToUnits(o.price);
      if (quoted === null) return "the quote has no readable amount";
      if (quoted !== inMessage) return `the template amount ${inMessage} differs from the quoted ${quoted}`;
      if (inMessage > capUnits) return `amount ${inMessage} is above the per-payment cap ${capUnits}`;
      return null;
    })();
    if (bad === null) return { state: "ok", option: o, amount: escrowAmountOf(o.extra!.message)!, template: o.extra!.message!, to: o.payTo! };
    firstReason ??= bad;
  }
  return refuse(firstReason ?? "no usable escrow entry");
}

export interface EscrowAuthorization { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string; }

/** Fill the template exactly as given (lowercase `from`, fresh nonce, window under 2 minutes) and build the authorization. */
export function buildEscrowRequest(offer: Extract<EscrowOffer, { state: "ok" }>, wallet: string, nonce: string, nowSec: number): { message: string; authorization: EscrowAuthorization } {
  const validAfter = String(nowSec - ESCROW_BACKDATE_SECONDS);
  const validBefore = String(nowSec - ESCROW_BACKDATE_SECONDS + ESCROW_WINDOW_SECONDS);
  const from = lc(wallet);
  const message = offer.template.replace("{from}", from).replace("{nonce}", nonce).replace("{validAfter}", validAfter).replace("{validBefore}", validBefore);
  return { message, authorization: { from, to: offer.to, value: offer.amount.toString(), validAfter, validBefore, nonce } };
}

/** The X-PAYMENT header value: base64 of the escrow envelope. */
export function encodeEscrowPayment(network: string, signature: string, authorization: EscrowAuthorization): string {
  return Buffer.from(JSON.stringify({ x402Version: 2, scheme: "escrow", network, payload: { signature, authorization } })).toString("base64");
}

export interface EscrowReceipt {
  receipt_hash: string | null; rail: string | null; payer: string | null; miner: string | null; intent: string | null;
  amount_uusdc: string | null; epoch_id: number | null; settlement: string | null; chain: string | null; timestamp: number | null;
}

/** Decode X-PAYMENT-RESPONSE. Returns null when it is missing or unreadable: no receipt is ever invented. */
export function decodeEscrowReceipt(header: string | null | undefined): EscrowReceipt | null {
  if (!header) return null;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, unknown>;
    const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : j[k] !== undefined && j[k] !== null ? String(j[k]) : null);
    const n = (k: string) => (typeof j[k] === "number" ? (j[k] as number) : null);
    return { receipt_hash: s("receipt_hash"), rail: s("rail"), payer: s("payer"), miner: s("miner"), intent: s("intent"), amount_uusdc: s("amount_uusdc"), epoch_id: n("epoch_id"), settlement: s("settlement"), chain: s("chain"), timestamp: n("timestamp") };
  } catch { return null; }
}

/** Is this a receipt for the payment we signed? Same payer, same amount, escrow rail, and a well-formed hash. */
export function escrowReceiptMatches(r: EscrowReceipt | null, wallet: string, value: bigint): boolean {
  return !!r && r.rail === "escrow" && /^0x[0-9a-fA-F]{64}$/.test(r.receipt_hash ?? "") && lc(r.payer) === lc(wallet) && r.amount_uusdc === value.toString();
}

export type EscrowFunding = { state: "ok"; available: bigint } | { state: "unfunded"; available: bigint; needed: bigint } | { state: "unknown"; reason: string };

/** Can the escrow balance pay `needed`? `available` is the ledger's own figure (balance minus unbilled minus a pending withdrawal). */
export function escrowFunding(available: string | bigint | null | undefined, needed: bigint): EscrowFunding {
  if (available === null || available === undefined) return { state: "unknown", reason: "the escrow balance could not be read" };
  let a: bigint;
  try { a = typeof available === "bigint" ? available : BigInt(available); } catch { return { state: "unknown", reason: "the escrow balance was not a number" }; }
  return a >= needed ? { state: "ok", available: a } : { state: "unfunded", available: a, needed };
}

export type RailChoice = { rail: Rail | "public"; reason: string };

/**
 * The order of rails: escrow (if its terms pass the pins and the available balance covers the cost), then exact (the existing
 * settlement rail, if its own assessment passed), then labelled public values. An unreadable escrow balance never falls back to
 * settlement: the run stays on public values and says why.
 */
export function chooseRail(escrow: EscrowOffer, funding: EscrowFunding | null, exact: { ok: boolean; reason: string }): RailChoice {
  if (escrow.state === "ok") {
    if (!funding || funding.state === "unknown") return { rail: "public", reason: `escrow offered but ${funding?.state === "unknown" ? funding.reason : "its balance was not checked"}; not falling back to settlement without knowing the balance` };
    if (funding.state === "ok") return { rail: "escrow", reason: `escrow funded: ${funding.available} uUSDC available` };
    const why = `escrow unfunded: ${funding.available} uUSDC available, ${funding.needed} needed`;
    return exact.ok ? { rail: "exact", reason: `${why}; paying by settlement instead` } : { rail: "public", reason: `${why}; and ${exact.reason}` };
  }
  const why = escrow.state === "refused" ? escrow.reason : "the node offers no escrow rail";
  return exact.ok ? { rail: "exact", reason: `${why}; paying by settlement instead` } : { rail: "public", reason: `${why}; and ${exact.reason}` };
}
