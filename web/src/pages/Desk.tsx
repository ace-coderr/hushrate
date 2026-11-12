import { selectPower } from "@hushrate/core";
import { Empty, PageHead } from "../components/Layout";
import { DispatchTape, SiteCard, Stat } from "../components/Widgets";
import { useHistory, useLatest, useStatus } from "../lib/data";
import { decideWith, hourSlots, marketFromTape } from "../lib/decisions";
import { ago, hourLabel, num, usd } from "../lib/format";
import { useStore } from "../lib/store";

export function Desk() {
  const latest = useLatest();
  const history = useHistory();
  const status = useStatus();
  const { sites, isSample, active, setActive, activeSite, settings } = useStore();
  const t = latest.data;

  return (
    <>
      <PageHead kicker="Desk" title="This hour, every site.">
        Live market from the latest tape, a 24-hour dispatch tape for the site you pick, and one decision card per site.
      </PageHead>

      {status.data && status.data.state !== "ok" && (
        <div className="notice warn" role="alert">
          Agent status: <b>{status.data.state}</b>. {status.data.reason} Last update {ago(status.data.updated_at)}.{status.data.degraded && status.data.degraded.length > 0 && <ul>{status.data.degraded.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}

      {latest.loading && <p className="muted">Loading the latest tape…</p>}
      {!latest.loading && !t && <Empty title="No market tape published yet">There is nothing real to show until the agent records its first hour. No numbers are invented in the meantime.</Empty>}

      {t && (
        <>
          <section className="stats">
            <Stat value={settings.hashUnit === "sats" ? `${num(t.hashprice.value_sats_per_ph_day)}` : usd(((t.hashprice.value_sats_per_ph_day ?? 0) / 1e8) * (t.btc_usd ?? 0), 2)}
              label={settings.hashUnit === "sats" ? "hashprice, sats per PH/s per day" : "hashprice, USD per PH/s per day"} sub={t.hashprice.source === "telegraph" ? "bought from Telegraph, verified" : "public 144-block value"} />
            <Stat value={usd(t.btc_usd)} label="BTC price" sub="mempool.space" />
            <Stat value={num(t.block_height)} label="Bitcoin block" sub={`${hourLabel(t.interval_start)} · ${ago(t.recorded_at)}`} />
          </section>
          <p className="small muted src-line">Hashprice source: {t.hashprice.label}.</p>

          <h2>Power prices by node</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>Node</th><th>Real-time $/MWh</th><th>Day-ahead $/MWh</th><th>Used for decisions</th></tr></thead>
              <tbody>
                {t.power.map((p) => {
                  const s = selectPower(p);
                  return (
                    <tr key={p.node}>
                      <td className="mono">{p.node}</td>
                      <td className="mono">{usd(p.real_time_usd_per_mwh, 2)}</td>
                      <td className="mono">{usd(p.day_ahead_usd_per_mwh, 2)}</td>
                      <td>{s.basis ? `${s.basis} · ${usd(s.usd_per_mwh, 2)}` : "none: sites on this node HOLD"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2>Dispatch tape</h2>
          <div className="row-between">
            <label className="field inline">Site
              <select value={active} onChange={(e) => setActive(Number(e.target.value))}>
                {sites.map((s, i) => <option key={s.name + i} value={i}>{s.name}</option>)}
              </select>
            </label>
            {isSample && <span className="chip">Sample fleet · demo assumptions · <a href="#/sites">enter your own</a></span>}
          </div>
          <DispatchTape slots={hourSlots(history.data ?? [])} site={activeSite} />

          <h2>Decisions now</h2>
          <div className="grid-cards">
            {sites.map((s) => {
              const m = marketFromTape(t, s.node);
              return <SiteCard key={s.name} site={s} market={m} d={decideWith(s, m)} />;
            })}
          </div>
        </>
      )}
    </>
  );
}
