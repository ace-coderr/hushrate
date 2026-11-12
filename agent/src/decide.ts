// Pure run/curtail economics. No I/O, no data of its own.

export interface Site {
  name: string;
  caiso_node: string;
  hashrate_th: number;            // operator-supplied fleet hashrate, TH/s
  efficiency_j_per_th: number;    // operator-supplied fleet efficiency, J/TH
  power_adder_usd_per_mwh: number;// operator-supplied delivery, fees and overhead on top of LMP
  min_margin_usd_per_day: number; // run only if margin exceeds this
}

export interface Inputs {
  lmp_usd_per_mwh: number;
  hashprice_sats_per_ph_day: number;
  btc_usd: number;
}

export interface Decision {
  action: "RUN" | "CURTAIL";
  revenue_usd_per_day: number;
  power_cost_usd_per_day: number;
  margin_usd_per_day: number;
  breakeven_lmp_usd_per_mwh: number;
}

const SECONDS_PER_DAY = 86400;

export function decide(site: Site, x: Inputs): Decision {
  // Energy used by the fleet over one day, in MWh: W = J/s, so TH/s * J/TH = W.
  const mwhPerDay = (site.hashrate_th * site.efficiency_j_per_th * SECONDS_PER_DAY) / 3.6e9;
  const revenue = (site.hashrate_th / 1000) * (x.hashprice_sats_per_ph_day / 1e8) * x.btc_usd;
  const allIn = x.lmp_usd_per_mwh + site.power_adder_usd_per_mwh;
  const cost = mwhPerDay * allIn;
  const margin = revenue - cost;
  return {
    action: margin > site.min_margin_usd_per_day ? "RUN" : "CURTAIL",
    revenue_usd_per_day: revenue,
    power_cost_usd_per_day: cost,
    margin_usd_per_day: margin,
    // LMP at which margin equals the threshold.
    breakeven_lmp_usd_per_mwh: (revenue - site.min_margin_usd_per_day) / mwhPerDay - site.power_adder_usd_per_mwh,
  };
}
