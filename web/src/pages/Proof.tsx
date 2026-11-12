import { useState } from "react";
import { fetchBlocks, windowHashprice, type MarketTape } from "@hushrate/core";
import { Empty, PageHead } from "../components/Layout";
import { useLatest, useLedger, type LedgerRow } from "../lib/data";
import { explorerTx, num, shortHash } from "../lib/format";

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const USDC = "0xcc194e1a843b658526d0d5c431f670028582ae17";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type Result = { state: "idle" | "running" | "pass" | "fail" | "error"; text: string; detail?: string };
const idle: Result = { state: "idle", text: "Not run yet." };

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

export function Proof() {
  const latest = useLatest();
  const ledger = useLedger();
  const t = latest.data;
  const [hp, setHp] = useState<Result>(idle);
  const [cmp, setCmp] = useState<Result>(idle);
  const [pay, setPay] = useState<Result>(idle);
  const rows = (ledger.data ?? []).filter((r) => r.tx_hash && r.http_status === 200);
  const tapeTx = t?.hashprice.telegraph?.tx_hash ?? null;
  const [pick, setPick] = useState<string>("");
  const tx = pick || tapeTx || rows[rows.length - 1]?.tx_hash || "";
  const row: LedgerRow | undefined = rows.find((r) => r.tx_hash === tx);

  async function recompute(tape: MarketTape) {
    setHp({ state: "running", text: "Reading 144 blocks from mempool.space…" });
    setCmp(idle);
    try {
      const w = windowHashprice(await fetchBlocks(tape.block_height!, 144));
      const rec = tape.hashprice.public_144?.hashprice_sats_per_ph_day;
      if (rec == null) { setHp({ state: "error", text: "The tape has no recorded 144-block value to compare." }); return; }
      const rel = Math.abs(w.hashprice_sats_per_ph_day - rec) / rec;
      setHp({
        state: rel < 0.001 ? "pass" : "fail",
        text: `Your browser computed ${num(w.hashprice_sats_per_ph_day, 2)} sats/PH/day from blocks ${w.from_height}–${w.to_height}; the tape recorded ${num(rec, 2)}. Difference ${(rel * 100).toFixed(4)}%.`,
        detail: rel < 0.001 ? "Match within 0.1%." : "Mismatch above 0.1%. A chain reorganisation or a bad record would explain it.",
      });
      // Compare the bought value using the same acceptance rule as the agent.
      const tg = tape.hashprice.telegraph;
      if (!tg || tg.value == null) { setCmp({ state: "error", text: "No Telegraph value on this tape (the run did not buy one, or the purchase failed)." }); return; }
      const d = Math.abs(tg.value - w.hashprice_sats_per_ph_day) / w.hashprice_sats_per_ph_day;
      const fieldsOk = ["hashprice_sats_per_ph_day", "block_height", "hashrate_eh_s"].every((k) => tg.field_status?.[k] === "ok");
      const would = fieldsOk && tg.returned_height === tape.block_height && d <= 0.01;
      const recorded = tape.hashprice.source === "telegraph";
      setCmp({
        state: would === recorded ? "pass" : "fail",
        text: `Bought value ${num(tg.value, 2)} vs your recomputation ${num(w.hashprice_sats_per_ph_day, 2)}: ${(d * 100).toFixed(3)}% apart (limit 1%). Rule says ${would ? "accept" : "reject"}; the tape used the ${recorded ? "Telegraph" : "public"} value.`,
        detail: would === recorded ? "The tape's choice matches the rule." : "The tape's choice does not match the rule.",
      });
    } catch (e) { setHp({ state: "error", text: `Could not recompute: ${(e as Error).message}` }); }
  }

  async function checkPayment() {
    if (!tx) return;
    setPay({ state: "running", text: "Asking a public Sepolia RPC for the transaction receipt…" });
    try {
      const r = await rpc("eth_getTransactionReceipt", [tx]);
      if (!r) { setPay({ state: "fail", text: "Transaction not found on Sepolia." }); return; }
      const ok = r.status === "0x1";
      const payer = (row?.payer ?? "").toLowerCase().replace(/^0x/, "");
      let total = 0n;
      for (const l of r.logs as { address: string; topics: string[]; data: string }[]) {
        if (l.address.toLowerCase() === USDC && l.topics[0] === TRANSFER && (!payer || l.topics[1]?.toLowerCase().endsWith(payer))) total += BigInt(l.data);
      }
      const need = BigInt(row?.amount_uusdc ?? "10000");
      const covered = total >= need;
      setPay({
        state: ok && covered ? "pass" : "fail",
        text: `Transaction ${ok ? "succeeded" : "failed"} in block ${parseInt(r.blockNumber, 16)}. Test-USDC transferred from the payer in this transaction: ${Number(total) / 1e6} (this request needed ${Number(need) / 1e6}).`,
        detail: "Several requests from one wallet can share a settlement transaction, so the total can exceed one request's cost.",
      });
    } catch (e) { setPay({ state: "error", text: `RPC check failed: ${(e as Error).message}` }); }
  }

  return (
    <>
      <PageHead kicker="Proof" title="Don't trust the page. Re-run the check.">
        These checks run in your browser against public sources. Each one ends in a plain match or mismatch.
      </PageHead>

      {latest.loading && <p className="muted">Loading the latest tape…</p>}
      {!latest.loading && !t && <Empty title="Nothing to verify yet">No market tape has been published.</Empty>}

      {t && (
        <div className="proof-steps">
          <section className="card check">
            <h3>1 · Recompute the 144-block hashprice</h3>
            <p>Reads the last 144 blocks ending at block {num(t.block_height)} from mempool.space and averages reward-and-difficulty hashprice per block.</p>
            <button className="pill primary" onClick={() => recompute(t)} disabled={hp.state === "running"}>Recompute in my browser</button>
            <Verdict r={hp} />
          </section>

          <section className="card check">
            <h3>2 · Compare with the value Hushrate bought</h3>
            <p>Applies the agent's acceptance rule (fields ok, same block, within 1%) to your own recomputation and checks the tape chose accordingly. Runs after step 1.</p>
            <Verdict r={cmp} />
          </section>

          <section className="card check">
            <h3>3 · Check the payment on Sepolia</h3>
            <p>Looks up the settlement transaction through a public RPC and finds the test-USDC transfer from the payer.</p>
            {rows.length > 0 ? (
              <label className="field inline">Transaction
                <select value={tx} onChange={(e) => { setPick(e.target.value); setPay(idle); }}>
                  {[...rows].reverse().map((r) => <option key={r.file} value={r.tx_hash!}>{r.label} · {shortHash(r.tx_hash)}</option>)}
                </select>
              </label>
            ) : <p className="muted">No settled payments in the ledger.</p>}
            <div className="cta-row">
              <button className="pill primary" onClick={checkPayment} disabled={!tx || pay.state === "running"}>Check on Sepolia</button>
              {tx && <a className="pill ghost" href={explorerTx(tx)} target="_blank" rel="noopener noreferrer">Open in explorer</a>}
            </div>
            <Verdict r={pay} />
          </section>
        </div>
      )}
    </>
  );
}

function Verdict({ r }: { r: Result }) {
  const label = { idle: "", running: "Running…", pass: "MATCH", fail: "MISMATCH", error: "COULD NOT CHECK" }[r.state];
  return (
    <div className={`verdict ${r.state}`} role="status" aria-live="polite">
      {label && <b>{label}</b>} <span>{r.text}</span>
      {r.detail && <small>{r.detail}</small>}
    </div>
  );
}
