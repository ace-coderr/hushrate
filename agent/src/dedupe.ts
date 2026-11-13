// The duplicate-request key for a paid call. Kept separate from x402.ts (which needs a key at import) so it can be tested.
export interface CallKeyInput { intent: string; params?: Record<string, unknown>; query?: string; minerId?: string; dedupe?: string; }

/**
 * `dedupe` makes the key unique per period for requests whose params never change: the BTC price has params
 * {symbol: "BTC"} forever, so without it the second purchase ever would be skipped as a duplicate of the first.
 * Requests with changing params (a block height, an interval) need no dedupe, and keep the original key format so
 * receipts written before this module existed still match.
 */
export const keyOf = (c: CallKeyInput) => JSON.stringify(
  c.dedupe ? [c.minerId ?? null, c.intent, c.params ?? null, c.query ?? null, `@${c.dedupe}`]
  : c.query ? [c.minerId ?? null, c.intent, c.params ?? null, c.query]
  : [c.minerId ?? null, c.intent, c.params]);

/**
 * Does a saved receipt count as a purchase that settled? A request refused with HTTP 402 means the node did not accept
 * the payment: nothing settled, so it must neither block a retry nor appear as a paid request.
 */
export const settledReceipt = (r: { paid?: boolean; http_status?: number | null }) => r.paid === true && r.http_status !== 402;
