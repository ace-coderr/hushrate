import { paidDataHealth } from "@hushrate/core";
import { useHistory, useStatus } from "../lib/data";
import { explorerAsset } from "../lib/format";

/**
 * "Paid data paused": shown when the two most recent hourly tapes both bought nothing. Decisions keep running on labelled
 * public values; this says so, how long it has lasted, and (when the wallet is the cause) what to fund.
 */
export function PaidDataBanner() {
  const history = useHistory();
  const status = useStatus();
  if (!history.data) return null;
  const h = paidDataHealth(history.data);
  if (!h.paused) return null;
  const s = status.data;
  const asset = s?.unfunded_asset ?? s?.payment_asset;
  const lastPaid = h.lastPaidHour ? h.lastPaidHour.slice(0, 16).replace("T", " ") : null;
  return (
    <div className="notice warn" role="alert">
      <b>Paid data paused.</b> The {h.consecutiveMisses} most recent hourly tapes in a row bought nothing, so the hashprice and BTC price on them are the labelled public values, not Telegraph's. Looking only at the past 24 hours, {h.publicOnlyHours24} of {h.tapes24} recorded tapes were public-only.{" "}
      {lastPaid ? `The last paid hour was ${lastPaid} UTC.` : "No paid hour is on record."}
      {s?.escrow?.available_usdc != null ? ` Escrow balance: ${s.escrow.available_usdc} USDC available.` : ""}
      {s?.unfunded && asset ? (
        <> The wallet is unfunded for <b>USDC</b> at <a className="mono" href={explorerAsset(asset)} target="_blank" rel="noopener noreferrer">{asset}</a> on Ethereum Sepolia, the asset the node asked for (Circle's faucet for the current one).</>
      ) : null}
      {s?.degraded?.length ? <ul>{s.degraded.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul> : null}
    </div>
  );
}
