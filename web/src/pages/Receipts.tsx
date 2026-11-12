import { useMemo } from "react";
import { Empty, PageHead } from "../components/Layout";
import { Stat } from "../components/Widgets";
import { useHistory, useLedger } from "../lib/data";
import { decideWith, marketFromEntry } from "../lib/decisions";
import { explorerTx, hourLabel, num, shortHash, usd } from "../lib/format";
import { useStore } from "../lib/store";

export function Receipts() {
  const ledger = useLedger();
  const history = useHistory();
  const { sites, isSample } = useStore();
  const rows = ledger.data ?? [];

  const value = useMemo(() => {
    const hist = history.data ?? [];
    let decisions = 0, run = 0, cut = 0, hold = 0, avoided = 0, earned = 0;
    for (const e of hist) for (const s of sites) {
      const d = decideWith(s, marketFromEntry(e, s.node));
      decisions++;
      if (d.action === "RUN") { run++; earned += (d.margin_usd_per_day ?? 0) / 24; }
      else if (d.action === "CURTAIL") { cut++; avoided += (d.loss_avoided_usd_per_day ?? 0) / 24; }
      else hold++;
    }
    return { hours: hist.length, decisions, run, cut, hold, avoided, earned, spent: hist.reduce((a, e) => a + e.cost_usd, 0) };
  }, [history.data, sites]);

  const billed = rows.reduce((a, r) => a + r.billed_usd, 0);
  const paid = rows.reduce((a, r) => a + r.paid_usd, 0);

  return (
    <>
      <PageHead kicker="Receipts" title="Every paid request, on the record.">
        Each row is a request that settled a test-USDC payment on Ethereum Sepolia. Failed requests are credited back to escrow, so they show as paid but billed $0.
      </PageHead>

      <section className="stats">
        <Stat value={num(rows.length)} label="paid requests" />
        <Stat value={`$${billed.toFixed(2)}`} label="billed" sub={`$${paid.toFixed(2)} paid, difference credited to escrow`} />
        <Stat value={`$${value.spent.toFixed(2)}`} label="data cost in the hourly tapes" sub={`${value.hours} hour(s) recorded`} />
      </section>

      {ledger.loading && <p className="muted">Loading the ledger…</p>}
      {!ledger.loading && rows.length === 0 && <Empty title="No paid requests recorded yet">Rows appear once the agent has bought its first reading.</Empty>}
      {rows.length > 0 && (
        <div className="scroll">
          <table>
            <thead><tr><th>When (UTC)</th><th>Request</th><th>Miner</th><th>Billed</th><th>Outcome</th><th>Receipt hash</th><th>Sepolia tx</th></tr></thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.file}>
                  <td>{hourLabel(r.at)}</td>
                  <td className="mono">{r.intent.replace(/_GENERAL$/, "")}</td>
                  <td>{r.miner_id ?? r.miner_requested ?? "n/a"}{r.miner_name ? ` · ${r.miner_name}` : ""}</td>
                  <td className="mono">{usd(r.billed_usd, 2)}</td>
                  <td>{r.outcome}</td>
                  <td className="mono" title={r.receipt_hash ?? ""}>{shortHash(r.receipt_hash)}</td>
                  <td className="mono">{r.tx_hash ? <a href={explorerTx(r.tx_hash)} target="_blank" rel="noopener noreferrer">{shortHash(r.tx_hash)}</a> : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>What the data costs against what it saves</h2>
      <div className="card">
        <p>
          Across the {value.hours} recorded hour(s) and {sites.length} {isSample ? "sample " : ""}site(s), Hushrate made <b>{num(value.decisions)}</b> decisions:
          {" "}{value.run} RUN, {value.cut} CURTAIL, {value.hold} HOLD. Running through the CURTAIL hours would have lost about{" "}
          <b>{usd(value.avoided, 2)}</b> (each hour's share of the daily margin). The data behind those hours cost <b>${value.spent.toFixed(2)}</b> in test USDC.
        </p>
        <dl>
          <dt>Cost per hourly tape</dt><dd className="mono">{value.hours ? usd(value.spent / value.hours, 2) : "n/a"}</dd>
          <dt>Loss avoided per decision</dt><dd className="mono">{value.decisions ? usd(value.avoided / value.decisions, 2) : "n/a"}</dd>
          <dt>Loss avoided per $1 of data</dt><dd className="mono">{value.spent > 0 ? usd(value.avoided / value.spent, 0) : "n/a"}</dd>
        </dl>
        <p className="small muted">
          This is arithmetic on {isSample ? "the sample fleet's demo assumptions" : "the sites you entered"} and the recorded market, not a measured saving: it assumes the site would otherwise have run. One tape serves every site, so the data cost does not grow with the number of sites.
        </p>
      </div>
    </>
  );
}
