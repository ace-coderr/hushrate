import type { Decision, Site } from "@hushrate/core";
import { hh, hourLabel, num, usd } from "../lib/format";
import type { Market, Slot } from "../lib/decisions";
import { decideWith, marketFromEntry } from "../lib/decisions";

export const cls = (a: string) => (a === "RUN" ? "run" : a === "CURTAIL" ? "cut" : "hold");

export function Badge({ action }: { action: string }) {
  return <span className={`badge ${cls(action)}`}>{action}</span>;
}

/** 24 cells, one per UTC hour. Gaps in the tape are HOLD, never filled in. */
export function DispatchTape({ slots, site, compact = false }: { slots: Slot[]; site: Site | null; compact?: boolean }) {
  const cells = slots.map((s, i) => {
    let action = "HOLD";
    let detail = "no tape recorded for this hour";
    if (site && s.entry) {
      const d = decideWith(site, marketFromEntry(s.entry, site.node));
      action = d.action;
      detail = d.action === "HOLD" ? d.reasons.join(", ") : `margin ${usd(d.margin_usd_per_day)}/day, power ${usd(marketFromEntry(s.entry, site.node).power_usd_per_mwh, 2)}/MWh`;
    } else if (!site) detail = "no site selected";
    return { ...s, action, detail, last: i === slots.length - 1 };
  });
  const counts = { RUN: 0, CURTAIL: 0, HOLD: 0 } as Record<string, number>;
  for (const c of cells) counts[c.action]++;
  return (
    <figure className={`tape ${compact ? "compact" : ""}`}>
      <div className="tape-track" role="list" aria-label="Dispatch tape, last 24 hours">
        {cells.map((c, i) => (
          <div key={c.hour} role="listitem" tabIndex={0} className={`cell ${cls(c.action)} ${c.last ? "now" : ""}`} style={{ animationDelay: `${i * 28}ms` }}
            aria-label={`${hourLabel(c.hour)}: ${c.action}. ${c.detail}`} title={`${hourLabel(c.hour)}: ${c.action}. ${c.detail}`}>
            <span className="cell-h">{hh(c.hour)}</span>
          </div>
        ))}
        <span className="scan" aria-hidden="true" />
      </div>
      <figcaption>
        <span className="key run">RUN {counts.RUN}</span>
        <span className="key cut">CURTAIL {counts.CURTAIL}</span>
        <span className="key hold">HOLD {counts.HOLD}</span>
        <span className="muted">UTC hours, oldest to newest. Grey means no market tape for that hour, or a missing input.</span>
      </figcaption>
    </figure>
  );
}

export function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="stat">
      <b className="mono">{value}</b>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Price against breakeven: the amber part is the range of power prices the site can afford. */
export function BreakevenBar({ price, breakeven }: { price: number; breakeven: number }) {
  const max = Math.max(price, breakeven, 1) * 1.25;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div>
      <div className="bar" role="img" aria-label={`Power price ${price.toFixed(2)} against breakeven ${breakeven.toFixed(2)} dollars per MWh`}>
        <em style={{ width: pct(breakeven) }} />
        <i style={{ left: `calc(${pct(price)} - 1px)` }} />
      </div>
      <div className="scale"><span>$0</span><span>amber: prices this site can pay · marker: now</span></div>
    </div>
  );
}

export function SiteCard({ site, market, d }: { site: Site; market: Market; d: Decision }) {
  return (
    <article className="card site-card">
      <div className="card-top">
        <div><h3>{site.name}</h3><p className="mono muted">{site.node}</p></div>
        <Badge action={d.action} />
      </div>
      {d.action === "HOLD" ? (
        <p className="hold-why">Hold because: {d.reasons.join("; ")}. Hushrate never guesses a missing input.</p>
      ) : (
        <>
          <dl>
            <dt>Power price ({market.basis})</dt><dd className="mono">{usd(market.power_usd_per_mwh, 2)}/MWh</dd>
            <dt>Revenue</dt><dd className="mono">{usd(d.revenue_usd_per_day)}/day</dd>
            <dt>Power cost</dt><dd className="mono">{usd(d.power_cost_usd_per_day)}/day</dd>
            <dt><b>Margin</b></dt><dd className="mono"><b>{usd(d.margin_usd_per_day)}/day</b></dd>
            <dt>Breakeven price</dt><dd className="mono">{usd(d.breakeven_power_usd_per_mwh, 2)}/MWh</dd>
            <dt>Fleet</dt><dd className="mono">{num(d.hashrate_th! / 1e6, 2)} EH/s · {num(site.power_mw, 1)} MW</dd>
          </dl>
          <BreakevenBar price={market.power_usd_per_mwh!} breakeven={d.breakeven_power_usd_per_mwh!} />
        </>
      )}
    </article>
  );
}
