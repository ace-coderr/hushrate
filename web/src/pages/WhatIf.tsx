import { useEffect, useState } from "react";
import { decide } from "@hushrate/core";
import { Empty, PageHead } from "../components/Layout";
import { Badge } from "../components/Widgets";
import { useLatest } from "../lib/data";
import { marketFromTape } from "../lib/decisions";
import { num, usd } from "../lib/format";
import { useStore } from "../lib/store";

export function WhatIf() {
  const latest = useLatest();
  const { sites, active, setActive, activeSite } = useStore();
  const t = latest.data;
  const real = t && activeSite ? marketFromTape(t, activeSite.node) : null;

  const [power, setPower] = useState<number | null>(null);
  const [hp, setHp] = useState<number | null>(null);
  const [eff, setEff] = useState<number | null>(null);

  // Start from the real current values for the selected site; the sliders only move away from real data on purpose.
  useEffect(() => {
    if (!activeSite) return;
    setEff(activeSite.efficiency_j_per_th);
    setPower(real?.power_usd_per_mwh ?? null);
    setHp(real?.hashprice_sats_per_ph_day ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSite?.name, t?.recorded_at]);

  if (latest.loading) return <><PageHead kicker="What-if" title="Move the market, watch the breakeven." /><p className="muted">Loading…</p></>;
  if (!t || !activeSite || !real || real.btc_usd === null) return <><PageHead kicker="What-if" title="Move the market, watch the breakeven." /><Empty title="Waiting for a real market tape">The sliders start from the latest real values, so they need a published tape first.</Empty></>;
  if (power === null || hp === null || eff === null) return <><PageHead kicker="What-if" title="Move the market, watch the breakeven." /><Empty title="No power price for this site's node">Pick another site, or wait for a tape that includes {activeSite.node}. Nothing is guessed.</Empty></>;

  const site = { ...activeSite, efficiency_j_per_th: eff };
  const d = decide(site, { power_usd_per_mwh: power, hashprice_sats_per_ph_day: hp, btc_usd: real.btc_usd });
  const realD = decide(activeSite, real);
  const moved = power !== real.power_usd_per_mwh || hp !== real.hashprice_sats_per_ph_day || eff !== activeSite.efficiency_j_per_th;

  // Margin curve across power prices.
  const xs = Array.from({ length: 61 }, (_, i) => -50 + i * 5);
  const ys = xs.map((x) => decide(site, { power_usd_per_mwh: x, hashprice_sats_per_ph_day: hp, btc_usd: real.btc_usd }).margin_usd_per_day ?? 0);
  const yMax = Math.max(...ys.map(Math.abs), 1);
  const W = 560, H = 200, px = (x: number) => ((x + 50) / 300) * W, py = (y: number) => H / 2 - (y / yMax) * (H / 2 - 10);
  const path = xs.map((x, i) => `${i ? "L" : "M"}${px(x).toFixed(1)},${py(ys[i]).toFixed(1)}`).join(" ");

  return (
    <>
      <PageHead kicker="What-if" title="Move the market, watch the breakeven.">
        Start from the real current values for a site, then slide price, hashprice or efficiency to see where RUN turns into CURTAIL.
      </PageHead>

      <label className="field inline">Site
        <select value={active} onChange={(e) => setActive(Number(e.target.value))}>{sites.map((s, i) => <option key={s.name + i} value={i}>{s.name}</option>)}</select>
      </label>

      <div className="whatif">
        <div className="card controls">
          <Slider label="Power price" unit="$/MWh" min={-50} max={250} step={0.5} value={power} real={real.power_usd_per_mwh!} onChange={setPower} fmt={(v) => usd(v, 2)} />
          <Slider label="Hashprice" unit="sats/PH/day" min={Math.round(hp * 0.4)} max={Math.round(hp * 1.8)} step={50} value={hp} real={real.hashprice_sats_per_ph_day!} onChange={setHp} fmt={(v) => num(v)} />
          <Slider label="Efficiency" unit="J/TH" min={10} max={50} step={0.5} value={eff} real={activeSite.efficiency_j_per_th} onChange={setEff} fmt={(v) => num(v, 1)} />
          <button className="pill ghost small-btn" disabled={!moved} onClick={() => { setPower(real.power_usd_per_mwh); setHp(real.hashprice_sats_per_ph_day); setEff(activeSite.efficiency_j_per_th); }}>Reset to real values</button>
        </div>

        <div className="card result" aria-live="polite">
          <div className="card-top"><h3>{moved ? "Scenario" : "Now (real values)"}</h3><Badge action={d.action} /></div>
          <dl>
            <dt>Revenue</dt><dd className="mono">{usd(d.revenue_usd_per_day)}/day</dd>
            <dt>Power cost</dt><dd className="mono">{usd(d.power_cost_usd_per_day)}/day</dd>
            <dt><b>Margin</b></dt><dd className="mono"><b>{usd(d.margin_usd_per_day)}/day</b></dd>
            <dt>Breakeven power price</dt><dd className="mono">{usd(d.breakeven_power_usd_per_mwh, 2)}/MWh</dd>
            <dt>Headroom</dt><dd className="mono">{usd(d.breakeven_power_usd_per_mwh! - power, 2)}/MWh</dd>
          </dl>
          {moved && <p className="small muted">Real values give {realD.action} at {usd(realD.margin_usd_per_day)}/day.</p>}
        </div>
      </div>

      <figure className="card chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily margin as power price changes" preserveAspectRatio="none">
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="axis" />
          <path d={path} className="curve" fill="none" />
          <line x1={px(power)} x2={px(power)} y1="0" y2={H} className="marker" />
          {d.breakeven_power_usd_per_mwh! > -50 && d.breakeven_power_usd_per_mwh! < 250 && <circle cx={px(d.breakeven_power_usd_per_mwh!)} cy={H / 2} r="5" className="be-dot" />}
        </svg>
        <figcaption className="small muted">Margin per day against power price, from -$50 to $250 per MWh. The dot is breakeven; the vertical line is your slider.</figcaption>
      </figure>
    </>
  );
}

function Slider({ label, unit, min, max, step, value, real, onChange, fmt }: { label: string; unit: string; min: number; max: number; step: number; value: number; real: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const id = `s-${label.replace(/\W/g, "")}`;
  return (
    <div className="slider">
      <label htmlFor={id}><span>{label}</span><b className="mono">{fmt(value)} <small>{unit}</small></b></label>
      <input id={id} type="range" min={min} max={Math.max(max, real)} step={step} value={Math.min(Math.max(value, min), Math.max(max, real))} onChange={(e) => onChange(Number(e.target.value))} />
      <small className="muted">Real now: {fmt(real)} {unit}</small>
    </div>
  );
}
