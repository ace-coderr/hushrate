// Same-hour paid-call guard. Two triggers in one UTC hour (the ticker and the schedule, or a manual run on
// top of either) must never cause two paid purchases, even when the Bitcoin block height has changed
// between them (the per-request duplicate check in x402.ts is keyed on the block height, so it alone is not enough).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { HistoryEntry } from "@hushrate/core";

export interface ReceiptFile { name: string; paid: boolean; }

/** `2026-11-12T20:00:00Z` -> the receipt file name prefix `2026-11-12T20-` (file names use UTC with dashes). */
export const hourPrefix = (hourIso: string) => `${hourIso.slice(0, 13)}-`;

/**
 * True when a paid purchase already belongs to this UTC hour. Two independent sources are checked so that
 * neither a lost history entry nor a lost receipt can allow a second purchase:
 *   1. the tape history entry for the hour recorded a paid call, or
 *   2. a saved receipt file stamped inside the hour has paid = true.
 * A refused or unpaid attempt does not count, so a failed hour can still be retried.
 */
export function paidThisHour(hourIso: string, history: Pick<HistoryEntry, "interval_start" | "paid_calls">[], receipts: ReceiptFile[]): { paid: boolean; why: string | null } {
  const h = history.find((e) => e.interval_start === hourIso);
  if (h && h.paid_calls > 0) return { paid: true, why: `tape for ${hourIso} already recorded ${h.paid_calls} paid call(s)` };
  const prefix = hourPrefix(hourIso);
  const r = receipts.find((f) => f.paid && f.name.startsWith(prefix));
  if (r) return { paid: true, why: `receipt ${r.name} is already paid inside this hour` };
  return { paid: false, why: null };
}

/** Reads history.json and the receipt files from disk (missing or unreadable files count as "nothing paid"). */
export function paidThisHourFromDisk(root: string, hourIso: string) {
  let history: HistoryEntry[] = [];
  try { history = JSON.parse(readFileSync(`${root}data/history.json`, "utf8")); } catch { /* none yet */ }
  const dir = `${root}data/receipts`;
  const receipts: ReceiptFile[] = [];
  if (existsSync(dir)) {
    const prefix = hourPrefix(hourIso);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || !name.startsWith(prefix)) continue; // only this hour's files are opened
      try { receipts.push({ name, paid: JSON.parse(readFileSync(`${dir}/${name}`, "utf8")).paid === true }); } catch { /* unreadable: ignore */ }
    }
  }
  return paidThisHour(hourIso, history, receipts);
}
