// Same-hour paid-call guard, per hour AND per intent.
//
// Two triggers in one UTC hour (the ticker and the schedule, or a manual run on top of either) must never make
// two purchases of the same kind, even when the Bitcoin block height has changed between them (the per-request
// duplicate check in x402.ts is keyed on the block height, so it alone is not enough). Because the agent buys two
// intents (hashprice and BTC price), the guard is per intent: a run that paid for hashprice but died before the
// BTC purchase may buy only the missing one, and an hour that already paid both is a no-op.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { HistoryEntry, PurchaseKind } from "@hushrate/core";

export const KINDS: PurchaseKind[] = ["hashprice", "btc"];

/** The agent labels its purchases `hashprice-<block>` and `btc-<hour>`. Probe, retest and research labels never count. */
export const LABEL_PREFIX: Record<PurchaseKind, string> = { hashprice: "hashprice-", btc: "btc-" };
const INTENT: Record<PurchaseKind, string> = { hashprice: "MINING_HASHPRICE_VERIFY_GENERAL", btc: "CRYPTO_PRICE_USD" };

export interface ReceiptFile { name: string; paid: boolean; label?: string; intent?: string; http_status?: number | null; }
export type HourPurchases = { [K in PurchaseKind]: boolean } & { why: Partial<Record<PurchaseKind, string>> };

/** `2026-11-12T20:00:00Z` -> the receipt file name prefix `2026-11-12T20-` (file names use UTC with dashes). */
export const hourPrefix = (hourIso: string) => `${hourIso.slice(0, 13)}-`;

const kindOfReceipt = (r: ReceiptFile): PurchaseKind | null => {
  for (const k of KINDS) if (r.intent === INTENT[k] && (r.label ?? "").startsWith(LABEL_PREFIX[k])) return k;
  return null;
};

/**
 * Which purchases already settled in this UTC hour. Two independent sources are checked per intent, so neither a
 * lost history entry nor a lost receipt can allow a second purchase:
 *   1. the tape history entry for the hour lists the kind in `paid_kinds` (old entries without that field only ever
 *      bought hashprice, so `paid_calls > 0` means hashprice), or
 *   2. a saved receipt stamped inside the hour has paid = true, the agent's label for that kind, and was not refused (402).
 * An unpaid or refused attempt does not count, so a failed purchase can be retried.
 */
export function purchasesThisHour(hourIso: string, history: Pick<HistoryEntry, "interval_start" | "paid_calls" | "paid_kinds">[], receipts: ReceiptFile[]): HourPurchases {
  const out: HourPurchases = { hashprice: false, btc: false, why: {} };
  const h = history.find((e) => e.interval_start === hourIso);
  if (h) {
    const kinds: PurchaseKind[] = h.paid_kinds ?? (h.paid_calls > 0 ? ["hashprice"] : []);
    for (const k of kinds) if (KINDS.includes(k)) { out[k] = true; out.why[k] = `tape for ${hourIso} already recorded a paid ${k} purchase`; }
  }
  const prefix = hourPrefix(hourIso);
  for (const r of receipts) {
    if (!r.paid || r.http_status === 402 || !r.name.startsWith(prefix)) continue;
    const k = kindOfReceipt(r);
    if (k && !out[k]) { out[k] = true; out.why[k] = `receipt ${r.name} is already paid inside this hour`; }
  }
  return out;
}

export const allBought = (p: HourPurchases) => p.hashprice && p.btc;

/** Reads history.json and this hour's receipt files from disk (missing or unreadable files count as "nothing paid"). */
export function purchasesThisHourFromDisk(root: string, hourIso: string): HourPurchases {
  let history: HistoryEntry[] = [];
  try { history = JSON.parse(readFileSync(`${root}data/history.json`, "utf8")); } catch { /* none yet */ }
  const dir = `${root}data/receipts`;
  const receipts: ReceiptFile[] = [];
  if (existsSync(dir)) {
    const prefix = hourPrefix(hourIso);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || !name.startsWith(prefix)) continue; // only this hour's files are opened
      try {
        const j = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
        receipts.push({ name, paid: j.paid === true, label: j.label, intent: j.intent, http_status: j.http_status ?? null });
      } catch { /* unreadable: ignore */ }
    }
  }
  return purchasesThisHour(hourIso, history, receipts);
}
