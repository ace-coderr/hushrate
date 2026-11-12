import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { validateSite, type Site } from "@hushrate/core";

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: keep working in memory */ }
}

// ---- settings --------------------------------------------------------------------------------
export interface Settings { theme: "system" | "light" | "dark"; hashUnit: "sats" | "usd"; }
const DEFAULT_SETTINGS: Settings = { theme: "dark", hashUnit: "sats" };

// ---- sites -----------------------------------------------------------------------------------
/**
 * SAMPLE FLEET: demo assumptions so the product is usable before you enter your own sites.
 * These are not customers and not measurements. Replace them on the Sites page.
 */
export const SAMPLE_FLEET: Site[] = [
  { name: "Sample A · modern fleet", node: "TH_SP15_GEN-APND", power_mw: 20, efficiency_j_per_th: 17.5, power_adder_usd_per_mwh: 8, min_margin_usd_per_day: 0 },
  { name: "Sample B · older fleet", node: "TH_NP15_GEN-APND", power_mw: 10, efficiency_j_per_th: 29.5, power_adder_usd_per_mwh: 12, min_margin_usd_per_day: 0 },
  { name: "Sample C · mid fleet", node: "TH_ZP26_GEN-APND", power_mw: 5, efficiency_j_per_th: 22, power_adder_usd_per_mwh: 10, min_margin_usd_per_day: 0 },
];

interface SitesState { sites: Site[]; sample: boolean; active: number; }

interface Ctx {
  settings: Settings; setSettings: (s: Partial<Settings>) => void;
  sites: Site[]; isSample: boolean; active: number; setActive: (i: number) => void;
  saveSites: (s: Site[]) => void; resetToSample: () => void;
  activeSite: Site | null;
}
const C = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setS] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("hushrate.settings.v1", {}) }));
  const [st, setSt] = useState<SitesState>(() => {
    const saved = read<SitesState | null>("hushrate.sites.v1", null);
    const ok = saved && Array.isArray(saved.sites) && saved.sites.length > 0 && saved.sites.every((s) => validateSite(s).length === 0);
    return ok ? { ...saved, active: Math.min(saved.active ?? 0, saved.sites.length - 1) } : { sites: SAMPLE_FLEET, sample: true, active: 0 };
  });

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = settings.theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : settings.theme === "dark";
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    write("hushrate.settings.v1", settings);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);

  const setSettings = useCallback((p: Partial<Settings>) => setS((s) => ({ ...s, ...p })), []);
  const persist = (next: SitesState) => { setSt(next); write("hushrate.sites.v1", next); };

  const value = useMemo<Ctx>(() => ({
    settings, setSettings,
    sites: st.sites, isSample: st.sample, active: st.active,
    setActive: (i) => persist({ ...st, active: Math.max(0, Math.min(i, st.sites.length - 1)) }),
    saveSites: (s) => persist({ sites: s, sample: false, active: Math.min(st.active, Math.max(0, s.length - 1)) }),
    resetToSample: () => persist({ sites: SAMPLE_FLEET, sample: true, active: 0 }),
    activeSite: st.sites[st.active] ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [settings, st]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useStore(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("StoreProvider missing");
  return v;
}

// ---- hash router -----------------------------------------------------------------------------
export const ROUTES = ["/", "/desk", "/sites", "/whatif", "/receipts", "/proof", "/docs", "/settings"] as const;
export type Route = (typeof ROUTES)[number];

export function useRoute(): Route {
  const get = (): Route => {
    const h = window.location.hash.replace(/^#/, "") || "/";
    return (ROUTES as readonly string[]).includes(h) ? (h as Route) : "/";
  };
  const [r, set] = useState<Route>(get);
  useEffect(() => {
    const f = () => { set(get()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}
