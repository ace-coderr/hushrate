// Builds data/ledger.json: one row per request that settled a payment, from the saved receipt files.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface LedgerRow {
  file: string;
  at: string;
  label: string;
  intent: string;
  miner_requested: string | null;
  miner_id: string | null;
  miner_name: string | null;
  http_status: number | null;
  /** USD billed. A settled payment whose request failed upstream is credited back, so it bills 0. */
  billed_usd: number;
  paid_usd: number;
  receipt_hash: string | null;
  tx_hash: string | null;
  signal_hash: string | null;
  outcome: string;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRICE_PER_CALL = 0.01;

export function buildLedger(root = ROOT): LedgerRow[] {
  const dir = `${root}data/receipts`;
  const rows: LedgerRow[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    let r: any;
    try { r = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); } catch { continue; }
    if (!r.paid) continue; // refused before payment: nothing was spent
    const b = r.response ?? {};
    const tr = r.telegraph_receipt ?? {};
    const ok = r.http_status === 200;
    rows.push({
      file: f,
      at: f.slice(0, 24).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z"),
      label: r.label,
      intent: r.intent,
      miner_requested: r.miner_id_requested ?? null,
      miner_id: b.miner_id ?? null,
      miner_name: b.miner_name ?? null,
      http_status: r.http_status ?? null,
      billed_usd: ok ? (b.cost_usd ?? PRICE_PER_CALL) : 0,
      paid_usd: PRICE_PER_CALL,
      receipt_hash: tr.receipt_hash ?? null,
      tx_hash: tr.tx_hash ?? r.payment_response?.transaction ?? b.payment?.transaction ?? null,
      signal_hash: b.signal_hash ?? null,
      outcome: ok ? "served" : "failed after payment; credited to escrow",
    });
  }
  return rows;
}

export function writeLedger(root = ROOT): number {
  const rows = buildLedger(root);
  writeFileSync(`${root}data/ledger.json`, JSON.stringify(rows, null, 2) + "\n");
  return rows.length;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  console.log(`ledger rows: ${writeLedger()}`);
}
