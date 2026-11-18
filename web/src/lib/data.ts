import { useEffect, useState } from "react";
import type { MarketTape, HistoryEntry } from "@hushrate/core";

export const BASE: string = import.meta.env.BASE_URL;

export interface Status {
  state: "ok" | "degraded" | "paused" | "error";
  degraded?: string[];
  updated_at: string;
  last_success_at?: string | null;
  reason?: string;
  usdc_balance?: string | null;
  /** The asset the balance is in and the agent is allowed to pay with. Absent on status files from before 2026-11-17. */
  /** The asset the node's 402 asked for this run (null when it could not be read or nothing needed buying). */
  payment_asset?: string | null;
  payment_network?: string;
  /** The allow-list: the only assets Hushrate pays. */
  allowed_assets?: string[];
  /** The balance of each allowed asset. */
  balances?: { asset: string; symbol: string; role: string; balance: string }[];
  /** The rail chosen for the last run: escrow, exact (settlement) or public (nothing bought). Absent before 2026-11-18. */
  rail?: "escrow" | "exact" | "public" | null;
  rail_reason?: string | null;
  /** The wallet's escrow balance on the Telegraph node, in USDC, as read by the agent. */
  escrow?: { diamond: string; token: string; read_at: string; available_usdc: string | null; deposited_usdc?: string; balance_usdc?: string; unbilled_usdc?: string; error?: string } | null;
  unfunded?: boolean;
  unfunded_asset?: string | null;
  last_tape?: string;
  paid_calls_last_run?: number;
  cost_usd_last_run?: number;
  hashprice_source?: string;
}

export interface LedgerRow {
  file: string; at: string; label: string; intent: string;
  miner_requested: string | null; miner_id: string | null; miner_name: string | null;
  http_status: number | null; billed_usd: number; paid_usd: number;
  receipt_hash: string | null; tx_hash: string | null; payer: string | null; amount_uusdc: string | null;
  signal_hash: string | null; outcome: string;
  /** Absent on a ledger file written before 2026-11-17: those rows are the previous asset. */
  asset?: string; network?: string;
  /** Absent on a ledger file written before 2026-11-18: those rows were paid by settlement (exact). */
  rail?: "escrow" | "exact";
  epoch_id?: number | null;
  billing_verified?: boolean | null;
  billing_status?: string | null;
  billing_checked_at?: string | null;
}

/** One on-chain funding of the escrow (data/deposits.json): public hashes only. */
export interface Deposit {
  at: string; network: string; wallet: string; token: string; diamond: string;
  amount_uusdc: string; amount_usdc: string; approve_tx: string | null; deposit_tx: string; deposit_block: number;
}

export interface Ticker {
  last_trigger?: string;
  last_trigger_at?: string;
  last_ticker_at?: string;
  last_schedule_at?: string;
  last_manual_at?: string;
}

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; }

const cache = new Map<string, Promise<unknown>>();
function load<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${BASE}${path}`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    });
    cache.set(path, p);
    p.catch(() => cache.delete(path));
  }
  return p;
}

export function useJson<T>(path: string): Loaded<T> {
  const [s, set] = useState<Loaded<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    load<T>(path).then((d) => live && set({ data: d, error: null, loading: false }), (e) => live && set({ data: null, error: String(e.message ?? e), loading: false }));
    return () => { live = false; };
  }, [path]);
  return s;
}

export const useLatest = () => useJson<MarketTape>("data/latest.json");
export const useHistory = () => useJson<HistoryEntry[]>("data/history.json");
export const useStatus = () => useJson<Status>("data/status.json");
export const useTicker = () => useJson<Ticker>("data/ticker.json");
export const useLedger = () => useJson<LedgerRow[]>("data/ledger.json");
export const useDeposits = () => useJson<Deposit[]>("data/deposits.json");
