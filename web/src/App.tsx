import { cycles, paymentFor, type Cycle, type Decision } from "./data";

const usd = (n: number, d = 0) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const hour = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";
const kind = (a: string) => (a.startsWith("RUN") ? "RUN" : a.startsWith("CURTAIL") ? "CURTAIL" : "HOLD");

function SiteCard({ d }: { d: Decision }) {
  const k = kind(d.action);
  const ok = d.lmp_usd_per_mwh !== undefined && d.breakeven_lmp_usd_per_mwh !== undefined;
  const be = ok ? d.breakeven_lmp_usd_per_mwh! : 0;
  const max = ok ? Math.max(d.lmp_usd_per_mwh!, be, 1) * 1.25 : 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div className="card">
      <div className="top">
        <div><h3>{d.site}</h3><div className="node">{d.node}</div></div>
        <span className={`badge ${k}`}>{k}</span>
      </div>
      {!ok ? <p className="note">{d.action}: {d.error}</p> : (
        <>
          <dl>
            <dt>Day-ahead price</dt><dd>{usd(d.lmp_usd_per_mwh!, 2)}/MWh</dd>
            <dt>Revenue</dt><dd>{usd(d.revenue_usd_per_day!)}/day</dd>
            <dt>Power cost</dt><dd>{usd(d.power_cost_usd_per_day!)}/day</dd>
            <dt><b>Margin</b></dt><dd><b>{usd(d.margin_usd_per_day!)}/day</b></dd>
            <dt>Breakeven price</dt><dd>{usd(be, 2)}/MWh</dd>
          </dl>
          <div className="bar" role="img" aria-label={`Price ${d.lmp_usd_per_mwh} against breakeven ${be}`}>
            <em style={{ width: pct(be) }} />
            <i style={{ left: `calc(${pct(d.lmp_usd_per_mwh!)} - 1px)` }} />
          </div>
          <div className="scale"><span>$0</span><span>green: prices you can afford; marker: this hour</span></div>
        </>
      )}
    </div>
  );
}

function Latest({ c }: { c: Cycle }) {
  const t = c.telegraph;
  const pay = paymentFor(t?.receipt_file);
  return (
    <>
      <h2>Latest decision · {hour(c.interval_start)}</h2>
      <div className="strip">
        <div className="stat"><b>{c.inputs.block_height.toLocaleString("en-US")}</b><span>Bitcoin block</span></div>
        <div className="stat"><b>{usd(c.inputs.btc_usd)}</b><span>BTC price</span></div>
        <div className="stat"><b>{Math.round(c.inputs.hashprice_sats_per_ph_day).toLocaleString("en-US")}</b><span>hashprice, sats per PH/s per day</span></div>
      </div>
      <h2>Sites</h2>
      <div className="sites">{c.decisions.map((d) => <SiteCard key={d.site} d={d} />)}</div>
      <h2>Where the numbers came from</h2>
      <div className="src">
        <p>Hashprice: {c.inputs.hashprice_source}.</p>
        <p>Power price: {c.inputs.power_source}.</p>
        {t?.miner_id && (
          <p>
            Telegraph miner {t.miner_id} returned {t.value_sats_per_ph_day?.toFixed(1)} sats/PH/day,{" "}
            {t.rel_diff_vs_public != null ? `${(t.rel_diff_vs_public * 100).toFixed(4)}% from the public calculation` : "not comparable"}. Cost $0.01 test USDC.
          </p>
        )}
        {pay?.receipt_hash && <p>Receipt <code>{pay.receipt_hash}</code></p>}
        {pay?.tx_hash && <p>Sepolia payment <code>{pay.tx_hash}</code></p>}
        {c.notes.map((n) => <p key={n} className="note">{n}</p>)}
      </div>
    </>
  );
}

export function App() {
  return (
    <div className="wrap">
      <header>
        <h1>Hushrate</h1>
        <p>Hourly run-or-curtail decisions for bitcoin mining sites, with a receipt for every one.</p>
      </header>
      <div className="banner">
        Testnet only. Data costs $0.01 in Ethereum Sepolia test USDC per cycle; no real money moves. Fleet figures are operator assumptions from <code>config/sites.json</code>.
      </div>
      {cycles.length === 0 ? (
        <p className="empty">No decisions saved yet. Run <code>npm run agent</code> and rebuild.</p>
      ) : (
        <>
          <Latest c={cycles[0]} />
          <h2>History</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>Hour</th><th>Site</th><th>Price $/MWh</th><th>Margin $/day</th><th>Decision</th></tr></thead>
              <tbody>
                {cycles.flatMap((c) => c.decisions.map((d) => (
                  <tr key={c.interval_start + d.site}>
                    <td>{hour(c.interval_start)}</td><td>{d.site}</td>
                    <td className="num">{d.lmp_usd_per_mwh?.toFixed(2) ?? "n/a"}</td>
                    <td className="num">{d.margin_usd_per_day !== undefined ? usd(d.margin_usd_per_day) : "n/a"}</td>
                    <td><span className={`badge ${kind(d.action)}`}>{kind(d.action)}</span></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
