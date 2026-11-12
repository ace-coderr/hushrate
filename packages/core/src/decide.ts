// Run/curtail economics. Pure functions, no I/O, no data of their own.
// Used by the agent, the web app and the MCP server so every surface agrees.

export interface Site {
  name: string;
  node: string;                       // pricing node, e.g. a CAISO node id
  power_mw: number;                   // continuous electrical load of the fleet, MW
  efficiency_j_per_th: number;        // fleet efficiency, joules per terahash
  power_adder_usd_per_mwh: number;    // delivery, fees and overhead on top of the market price
  min_margin_usd_per_day: number;     // run only if margin is strictly above this
}

export interface MarketInput {
  power_usd_per_mwh?: number | null;
  hashprice_sats_per_ph_day?: number | null;
  btc_usd?: number | null;
}

export type Action = "RUN" | "CURTAIL" | "HOLD";

export interface Decision {
  action: Action;
  /** Why the action is HOLD (missing or invalid input) or empty otherwise. */
  reasons: string[];
  hashrate_th?: number;
  energy_mwh_per_day?: number;
  revenue_usd_per_day?: number;
  power_cost_usd_per_day?: number;
  margin_usd_per_day?: number;
  breakeven_power_usd_per_mwh?: number;
  /** Margin lost per day if the site ran against the market (only for CURTAIL), else 0. */
  loss_avoided_usd_per_day?: number;
}

const SECONDS_PER_DAY = 86400;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate a site definition. Returns human-readable errors (empty when valid). */
export function validateSite(s: Partial<Site>): string[] {
  const e: string[] = [];
  if (!s.name || !String(s.name).trim()) e.push("name is required");
  if (!s.node || !String(s.node).trim()) e.push("node is required");
  if (!finite(s.power_mw) || s.power_mw <= 0) e.push("power_mw must be a number above 0");
  if (!finite(s.efficiency_j_per_th) || s.efficiency_j_per_th <= 0) e.push("efficiency_j_per_th must be a number above 0");
  if (!finite(s.power_adder_usd_per_mwh)) e.push("power_adder_usd_per_mwh must be a number");
  if (!finite(s.min_margin_usd_per_day)) e.push("min_margin_usd_per_day must be a number");
  return e;
}

/** Fleet hashrate implied by load and efficiency. W = J/s, so TH/s = W / (J/TH). */
export const hashrateTh = (s: Pick<Site, "power_mw" | "efficiency_j_per_th">) => (s.power_mw * 1e6) / s.efficiency_j_per_th;

/** USD value of one PH/s for one day. */
export const usdPerPhDay = (sats: number, btcUsd: number) => (sats / 1e8) * btcUsd;

export function decide(site: Site, m: MarketInput): Decision {
  const reasons: string[] = validateSite(site).map((r) => `site: ${r}`);
  if (!finite(m.power_usd_per_mwh)) reasons.push("power price missing");
  if (!finite(m.hashprice_sats_per_ph_day) || (m.hashprice_sats_per_ph_day as number) <= 0) reasons.push("hashprice missing");
  if (!finite(m.btc_usd) || (m.btc_usd as number) <= 0) reasons.push("BTC price missing");
  if (reasons.length) return { action: "HOLD", reasons };

  const power = m.power_usd_per_mwh as number;
  const hashprice = m.hashprice_sats_per_ph_day as number;
  const btc = m.btc_usd as number;

  const th = hashrateTh(site);
  const mwhPerDay = site.power_mw * 24;
  const revenue = (th / 1000) * usdPerPhDay(hashprice, btc);
  const cost = mwhPerDay * (power + site.power_adder_usd_per_mwh);
  const margin = revenue - cost;
  const action: Action = margin > site.min_margin_usd_per_day ? "RUN" : "CURTAIL";
  return {
    action,
    reasons: [],
    hashrate_th: th,
    energy_mwh_per_day: mwhPerDay,
    revenue_usd_per_day: revenue,
    power_cost_usd_per_day: cost,
    margin_usd_per_day: margin,
    // Market power price at which margin equals the threshold.
    breakeven_power_usd_per_mwh: (revenue - site.min_margin_usd_per_day) / mwhPerDay - site.power_adder_usd_per_mwh,
    loss_avoided_usd_per_day: action === "CURTAIL" ? Math.max(0, -margin) : 0,
  };
}
