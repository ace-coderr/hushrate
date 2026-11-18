import { useMemo } from "react";
import { Empty, PageHead } from "../components/Layout";
import { Stat } from "../components/Widgets";
import { useDeposits, useHistory, useLedger, type LedgerRow } from "../lib/data";
import { decideWith, marketFromEntry } from "../lib/decisions";
import { explorerAddr, explorerAsset, explorerTx, hourLabel, num, shortHash, usd } from "../lib/format";
import { paymentAssetOf, sameAddress, LEGACY_PAYMENT_ASSET } from "@hushrate/core";
import { useStore } from "../lib/store";

const PURPOSE: Record<string, string> = { MINING_HASHPRICE_VERIFY_GENERAL: "hashprice", CRYPTO_PRICE_USD: "BTC/USD price", GRID_POWER_PRICE_GENERAL: "power price" };
const purpose = (r: { intent: string; label: string }) => `${PURPOSE[r.intent] ?? r.intent}${/^(probe|retest|Sd|A-|B-|agent-)/.test(r.label) ? " · research probe" : ""}`;

/** What the Billing column says for an escrow row. Never claims verified without a recorded real response. */
function billingCell(r: LedgerRow) {
  if (r.rail !== "escrow") return <span className="muted">n/a (settled per call)</span>;
  if (r.billing_verified === true) return <><span className="badge run">verified</span><br /><small className="muted">{r.billing_checked_at ? `${hourLabel(r.billing_checked_at)} UTC` : ""}</small></>;
  if (r.billing_verified === false) return <><span className="badge cut">not found</span><br /><small className="muted">{r.billing_status}</small></>;
  return <><span className="badge hold">pending</span><br /><small className="muted">{r.billing_checked_at ? `checked ${hourLabel(r.billing_checked_at)} UTC, epoch block not recorded yet` : "not checked yet; the node records the epoch's block up to about an hour later"}</small></>;
}

export function Receipts() {
  const deposits = useDeposits();
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
        Each row is a request that was paid in test USDC on Ethereum Sepolia: the hourly hashprice and BTC price purchases, plus the research probes used to pick miners. Since 2026-11-18 purchases are paid from escrow: one on-chain deposit funds many calls, so an escrow call has a receipt hash and a billing record, not its own transaction. Older rows were settled per call and have a transaction. Failed requests are credited back to escrow, so they show as paid but billed $0.
      </PageHead>

      <section className="stats">
        <Stat value={num(rows.length)} label="paid requests" />
        <Stat value={`$${billed.toFixed(2)}`} label="billed" sub={`$${paid.toFixed(2)} paid, difference credited to escrow`} />
        <Stat value={`$${value.spent.toFixed(2)}`} label="data cost in the hourly tapes" sub={`${value.hours} hour(s) recorded`} />
      </section>

      <h2>Escrow funding, on chain</h2>
      <div className="card">
        {deposits.loading && <p className="muted">Loading deposits…</p>}
        {!deposits.loading && (deposits.data ?? []).length === 0 && <p className="muted">No escrow deposit is recorded.</p>}
        {(deposits.data ?? []).length > 0 && (
          <div className="scroll"><table>
            <thead><tr><th>When (UTC)</th><th>Amount</th><th>Approve tx</th><th>Deposit tx</th><th>Escrow (Diamond)</th></tr></thead>
            <tbody>{[...(deposits.data ?? [])].reverse().map((d) => (
              <tr key={d.deposit_tx}>
                <td>{hourLabel(d.at)}</td>
                <td className="mono">{d.amount_usdc} USDC</td>
                <td className="mono">{d.approve_tx ? <a href={explorerTx(d.approve_tx)} target="_blank" rel="noopener noreferrer">{shortHash(d.approve_tx)}</a> : "n/a"}</td>
                <td className="mono"><a href={explorerTx(d.deposit_tx)} target="_blank" rel="noopener noreferrer">{shortHash(d.deposit_tx)}</a><br /><small className="muted">block {num(d.deposit_block)}</small></td>
                <td className="mono"><a href={explorerAddr(d.diamond)} target="_blank" rel="noopener noreferrer">{shortHash(d.diamond, 8, 6)}</a><br /><small className="muted"><a href={explorerAsset(d.token)} target="_blank" rel="noopener noreferrer">USDC {shortHash(d.token, 6, 4)}</a></small></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted">These are the on-chain transactions that funded the escrow. Individual escrow calls are not separate transactions: the node charges them in its epoch ledger root, and each call's receipt hash can be checked against it (Billing column, and the Proof page).</p>
      </div>

      <h2>Paid requests</h2>
      {ledger.loading && <p className="muted">Loading the ledger…</p>}
      {!ledger.loading && rows.length === 0 && <Empty title="No paid requests recorded yet">Rows appear once the agent has bought its first reading.</Empty>}
      {rows.length > 0 && (
        <div className="scroll">
          <table>
            <thead><tr><th>When (UTC)</th><th>Request</th><th>Miner</th><th>Billed</th><th>Outcome</th><th>Rail</th><th>Receipt hash</th><th>Billing</th><th>Sepolia tx</th></tr></thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.file}>
                  <td>{hourLabel(r.at)}</td>
                  <td><span className="mono">{r.intent.replace(/_GENERAL$/, "")}</span><br /><small className="muted">{purpose(r)}</small></td>
                  <td>{r.miner_id ?? r.miner_requested ?? "n/a"}{r.miner_name ? ` · ${r.miner_name}` : ""}</td>
                  <td className="mono">{usd(r.billed_usd, 2)}</td>
                  <td>{r.outcome}</td>
                  <td>{r.rail === "escrow" ? "escrow" : "settled"}{r.epoch_id != null && <><br /><small className="muted">epoch {r.epoch_id}</small></>}</td>
                  <td className="mono" title={r.receipt_hash ?? ""}>{shortHash(r.receipt_hash)}</td>
                  <td>{billingCell(r)}</td>
                  <td className="mono">{r.tx_hash ? <a href={explorerTx(r.tx_hash)} target="_blank" rel="noopener noreferrer">{shortHash(r.tx_hash)}</a> : r.rail === "escrow" ? "none (escrow)" : "n/a"}<br /><small className="muted"><a href={explorerAsset(paymentAssetOf(r))} target="_blank" rel="noopener noreferrer">{sameAddress(paymentAssetOf(r), LEGACY_PAYMENT_ASSET) ? "previous USDC" : "USDC"} {shortHash(paymentAssetOf(r), 6, 4)}</a></small></td>
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
