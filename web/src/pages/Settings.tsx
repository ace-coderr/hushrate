import { PageHead } from "../components/Layout";
import { BASE, useHistory, useLatest, useLedger, useStatus } from "../lib/data";
import { ago, hourLabel } from "../lib/format";
import { useStore } from "../lib/store";

export function Settings() {
  const { settings, setSettings } = useStore();
  const status = useStatus();
  const latest = useLatest();
  const history = useHistory();
  const ledger = useLedger();
  const s = status.data;
  const files = [
    ["data/latest.json", "Latest market tape"],
    ["data/history.json", "Rolling hourly history (last 500)"],
    ["data/ledger.json", "Paid-request ledger"],
    ["data/status.json", "Agent status"],
  ];

  return (
    <>
      <PageHead kicker="Settings" title="Display and data status.">Preferences stay in this browser. The status panel reads the agent's own status file.</PageHead>

      <div className="grid-cards">
        <section className="card">
          <h3>Theme</h3>
          <div className="seg" role="radiogroup" aria-label="Theme">
            {(["dark", "light", "system"] as const).map((t) => (
              <button key={t} role="radio" aria-checked={settings.theme === t} className={settings.theme === t ? "on" : ""} onClick={() => setSettings({ theme: t })}>{t}</button>
            ))}
          </div>
          <h3>Hashprice units</h3>
          <div className="seg" role="radiogroup" aria-label="Hashprice units">
            {([["sats", "sats per PH/s per day"], ["usd", "USD per PH/s per day"]] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={settings.hashUnit === k} className={settings.hashUnit === k ? "on" : ""} onClick={() => setSettings({ hashUnit: k })}>{l}</button>
            ))}
          </div>
          <p className="small muted">Power prices are always dollars per MWh and margins dollars per day, so they match the decision math exactly.</p>
        </section>

        <section className="card">
          <h3>Agent status</h3>
          {status.loading && <p className="muted">Loading…</p>}
          {status.error && <p className="muted">No status file published yet ({status.error}).</p>}
          {s && (
            <dl>
              <dt>State</dt><dd><span className={`badge ${s.state === "ok" ? "run" : s.state === "paused" ? "hold" : "cut"}`}>{s.state}</span></dd>
              <dt>Updated</dt><dd>{ago(s.updated_at)}</dd>
              {s.reason && <><dt>Reason</dt><dd>{s.reason}</dd></>}
              {s.usdc_balance && <><dt>Test-USDC balance</dt><dd className="mono">{s.usdc_balance}</dd></>}
              {s.paid_calls_last_run !== undefined && <><dt>Last run</dt><dd className="mono">{s.paid_calls_last_run} paid call(s), ${(s.cost_usd_last_run ?? 0).toFixed(2)}</dd></>}
              {s.hashprice_source && <><dt>Hashprice source</dt><dd>{s.hashprice_source}</dd></>}
            </dl>
          )}
          {latest.data && <p className="small muted">Latest tape: {hourLabel(latest.data.interval_start)}, recorded {ago(latest.data.recorded_at)}. History holds {history.data?.length ?? 0} hour(s); the ledger holds {ledger.data?.length ?? 0} paid request(s).</p>}
        </section>
      </div>

      <h2>Published data</h2>
      <ul className="file-list">
        {files.map(([f, d]) => <li key={f}><a className="mono" href={`${BASE}${f}`} target="_blank" rel="noopener noreferrer">{f}</a> <span className="muted">{d}</span></li>)}
      </ul>
    </>
  );
}
