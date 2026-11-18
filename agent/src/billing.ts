// Billing verification for escrow receipts. Free: only GET requests to the node, no key, no payment.
//   tsx src/billing.ts          check every escrow receipt that is not yet verified, record the result in data/billing.json
//
// Escrow has no per-call transaction, so the proof that a call was billed is the node's delivery record for its epoch:
//   GET <node>/v1/blocks/{epochId}/deliveries/{receiptHash}
// Until the epoch's block is recorded the node answers 404 (up to about an hour on the testnet); those stay "pending". A receipt
// is marked verified only after a 200 that names this wallet as the payer, and not-verified only after a real "not found" answer.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyBilling, type BillingRecord } from "@hushrate/core";
import { loadNetwork } from "./network.js";
import { writeLedger } from "./ledger.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface Pending { receipt_hash: string; epoch_id: number | null; }

/** Escrow receipts on disk that have a receipt hash and are not yet recorded as verified. */
export function receiptsToCheck(root: string, done: Record<string, BillingRecord>): Pending[] {
  const dir = `${root}data/receipts`;
  if (!existsSync(dir)) return [];
  const out: Pending[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    let r: any; try { r = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); } catch { continue; }
    if (r.rail !== "escrow" || r.paid !== true || r.http_status !== 200) continue;
    const h: unknown = r.escrow_receipt?.receipt_hash;
    if (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)) continue;
    if (done[h.toLowerCase()]?.billing_verified === true) continue;
    out.push({ receipt_hash: h, epoch_id: typeof r.escrow_receipt?.epoch_id === "number" ? r.escrow_receipt.epoch_id : null });
  }
  return out;
}

export async function checkBilling(root = ROOT, fetcher: typeof fetch = fetch, now = () => new Date().toISOString()): Promise<BillingRecord[]> {
  const net = loadNetwork();
  const file = `${root}data/billing.json`;
  let list: BillingRecord[] = [];
  try { list = JSON.parse(readFileSync(file, "utf8")); } catch { /* none yet */ }
  const byHash: Record<string, BillingRecord> = Object.fromEntries(list.map((b) => [b.receipt_hash.toLowerCase(), b]));
  const todo = receiptsToCheck(root, byHash);
  for (const p of todo) {
    if (p.epoch_id === null) { byHash[p.receipt_hash.toLowerCase()] = { receipt_hash: p.receipt_hash, epoch_id: null, billing_verified: null, status: "error", checked_at: now(), http_status: null, note: "the receipt has no epoch_id, so there is nothing to look up" }; continue; }
    let status: number | null = null; let body: unknown = null;
    try {
      const r = await fetcher(`${net.telegraph_node}/v1/blocks/${p.epoch_id}/deliveries/${p.receipt_hash}`, { signal: AbortSignal.timeout(30000) });
      status = r.status; body = await r.json().catch(() => null);
    } catch { status = null; }
    const rec = classifyBilling({ receipt_hash: p.receipt_hash, epoch_id: p.epoch_id, wallet: net.expected_wallet, http_status: status, body, now: now() });
    byHash[p.receipt_hash.toLowerCase()] = rec;
    console.log(`billing ${p.receipt_hash.slice(0, 12)}… epoch ${p.epoch_id}: ${rec.status}${rec.billing_verified === true ? " (verified)" : ""}`);
  }
  const all = Object.values(byHash).sort((a, b) => a.checked_at.localeCompare(b.checked_at));
  writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
  if (todo.length) console.log(`ledger rows: ${writeLedger(root)}`);
  return all;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  const all = await checkBilling();
  console.log(`billing records: ${all.length}, verified: ${all.filter((b) => b.billing_verified === true).length}`);
}
