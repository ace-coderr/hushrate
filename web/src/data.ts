// Real agent output only: decision receipts and Telegraph payment receipts saved under ../data.
export interface Decision {
  site: string;
  node: string;
  action: string;
  error?: string;
  lmp_usd_per_mwh?: number;
  revenue_usd_per_day?: number;
  power_cost_usd_per_day?: number;
  margin_usd_per_day?: number;
  breakeven_lmp_usd_per_mwh?: number;
}

export interface Cycle {
  interval_start: string;
  decided_at: string;
  inputs: {
    block_height: number;
    btc_usd: number;
    hashprice_sats_per_ph_day: number;
    hashprice_source: string;
    power_source: string;
  };
  telegraph: null | {
    http_status?: number;
    paid?: boolean;
    receipt_file?: string;
    miner_id?: string;
    value_sats_per_ph_day?: number | null;
    rel_diff_vs_public?: number | null;
    signal_hash?: string;
    skipped_existing_receipt?: string;
  };
  notes: string[];
  decisions: Decision[];
}

export interface PaymentReceipt {
  telegraph_receipt?: { receipt_hash?: string; tx_hash?: string; amount_uusdc?: string; chain?: string } | null;
}

const decisionFiles = import.meta.glob("../../data/decisions/*.json", { eager: true, import: "default" }) as Record<string, Cycle>;
const receiptFiles = import.meta.glob("../../data/receipts/*.json", { eager: true, import: "default" }) as Record<string, PaymentReceipt>;

/** Newest first. */
export const cycles: Cycle[] = Object.values(decisionFiles).sort((a, b) => b.interval_start.localeCompare(a.interval_start));

export function paymentFor(file?: string): PaymentReceipt["telegraph_receipt"] {
  if (!file) return null;
  const hit = Object.entries(receiptFiles).find(([p]) => p.endsWith(`/${file}`));
  return hit ? hit[1].telegraph_receipt ?? null : null;
}
