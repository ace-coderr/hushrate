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
