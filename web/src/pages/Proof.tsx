import { useState } from "react";
import { blockHashprice, checkBtcPurchase, checkHashpricePurchase, fetchBlocks, fetchBtcUsd, windowHashprice, type MarketTape } from "@hushrate/core";
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
  const [btc, setBtc] = useState<Result>(idle);
  const [pay, setPay] = useState<Result>(idle);
  const rows = (ledger.data ?? []).filter((r) => r.tx_hash && r.http_status === 200);
  const tapeTx = t?.hashprice.telegraph?.tx_hash ?? null;
  const [pick, setPick] = useState<string>("");
  const tx = pick || tapeTx || rows[rows.length - 1]?.tx_hash || "";
  const row: LedgerRow | undefined = rows.find((r) => r.tx_hash === tx);

  async function recompute(tape: MarketTape) {
    if (tape.block_height === null) { setHp({ state: "error", text: "This tape has no block height (mempool.space was unreachable that hour), so there is nothing to recompute." }); setCmp(idle); return; }
    setHp({ state: "running", text: "Reading 144 blocks from mempool.space…" });
    setCmp(idle);
    try {
      const w = windowHashprice(await fetchBlocks(tape.block_height, 144));
      const rec = tape.hashprice.public_144?.hashprice_sats_per_ph_day;
      if (rec == null) { setHp({ state: "error", text: "The tape has no recorded 144-block value to compare." }); return; }
      const rel = Math.abs(w.hashprice_sats_per_ph_day - rec) / rec;
      setHp({
        state: rel < 0.001 ? "pass" : "fail",
        text: `Your browser computed ${num(w.hashprice_sats_per_ph_day, 2)} sats/PH/day from blocks ${w.from_height}–${w.to_height}; the tape recorded ${num(rec, 2)}. Difference ${(rel * 100).toFixed(4)}%.`,
        detail: rel < 0.001 ? "Match within 0.1%." : "Mismatch above 0.1%. A chain reorganisation or a bad record would explain it.",
      });
      await compareBought(tape, w.hashprice_sats_per_ph_day);
    } catch (e) { setHp({ state: "error", text: `Could not recompute: ${(e as Error).message}` }); }
  }

  /**
   * Step 2: re-apply the agent's acceptance rule to the bought hashprice, using the rule that was in force when the tape was recorded.
   *  - Tapes from 2026-11-14 on (comparison: single_block_at_returned_height): the value is checked against the public hashprice of
   *    the ONE block the miner returned, recomputed here from that block's reward and difficulty. That is the quantity the miner computes.
   *  - Older tapes: the value was checked against the 144-block mean, so that is re-applied (and shown as the legacy comparison).
   */
  async function compareBought(tape: MarketTape, mean144: number) {
    const tg = tape.hashprice.telegraph;
    if (!tg || tg.value == null) { setCmp({ state: "error", text: "No Telegraph value on this tape (the run did not buy one, or the purchase failed)." }); return; }
    const recorded = tape.hashprice.source === "telegraph";
    const TOL = tape.hashprice.tolerance_rel ?? 0.01;
    if (tape.hashprice.comparison === "single_block_at_returned_height") {
      if (tg.returned_height == null) { setCmp({ state: "error", text: "The miner returned no block height, so there is no matching block to check against." }); return; }
      setCmp({ state: "running", text: `Reading block ${tg.returned_height} to recompute its single-block hashprice…` });
      try {
        const [b] = await fetchBlocks(tg.returned_height, 1);
        const pub = blockHashprice(b.reward_sats, b.difficulty);
        const r = checkHashpricePurchase(tg, tape.block_height, pub, TOL);
        const rel = r.rel === null ? "n/a" : `${(r.rel * 100).toFixed(3)}%`;
        setCmp({
          state: r.accepted === recorded ? "pass" : "fail",
          text: `Bought ${num(tg.value, 2)} vs the public single-block value at block ${tg.returned_height}, recomputed in your browser: ${num(pub, 2)}. ${rel} apart (limit ${TOL * 100}%). Rule says ${r.accepted ? "accept" : `reject (${r.reason})`}; the tape used the ${recorded ? "Telegraph" : "public"} value.`,
          detail: (r.accepted === recorded ? "The tape's choice matches the rule. " : "The tape's choice does not match the rule. ") + "This compares like with like: the miner computes one block, so it is checked against that one block, not against the 144-block mean shown in step 1.",
        });
      } catch (e) { setCmp({ state: "error", text: `Could not read the block: ${(e as Error).message}` }); }
      return;
    }
    // Legacy tapes: the rule at the time was "within 1% of the 144-block mean", with the same field and height checks.
    const d = Math.abs(tg.value - mean144) / mean144;
    const fieldsOk = ["hashprice_sats_per_ph_day", "block_height", "hashrate_eh_s"].every((k) => tg.field_status?.[k] === "ok");
    const would = fieldsOk && tg.returned_height === tape.block_height && d <= 0.01;
    setCmp({
      state: would === recorded ? "pass" : "fail",
      text: `Legacy rule (this tape predates the single-block comparison). Bought value ${num(tg.value, 2)} vs your recomputed 144-block mean ${num(mean144, 2)}: ${(d * 100).toFixed(3)}% apart (limit 1%). Rule says ${would ? "accept" : "reject"}; the tape used the ${recorded ? "Telegraph" : "public"} value.`,
      detail: (would === recorded ? "The tape's choice matches the rule that was in force. " : "The tape's choice does not match the rule. ") + "Note: the 144-block mean is a different quantity from the single block the miner computes, which is why this rule rejected accurate values after a difficulty adjustment (docs/hashprice-drift.md).",
    });
  }

  // Applies the agent's own BTC acceptance rule (shared code in @hushrate/core) to the values recorded on the tape.
  async function checkBtc(tape: MarketTape) {
    const b = tape.btc;
    if (!b) { setBtc({ state: "error", text: "This tape predates the paid BTC price: it used the public mempool.space price only, so there is no bought value to check." }); return; }
    if (!b.telegraph) { setBtc({ state: "error", text: `No Telegraph BTC price was bought for this hour (${b.label}).` }); return; }
    const TOL = b.tolerance_rel ?? 0.005; // the limit the agent recorded; 0.5% for tapes that predate recording it
    const r = checkBtcPurchase(b.telegraph, b.public_usd, TOL);
    const recorded = b.source === "telegraph";
    const rel = r.rel === null ? "n/a" : `${(r.rel * 100).toFixed(3)}%`;
    // The verdict is shown immediately: it depends only on the recorded values. The live price below is optional context.
    const verdict = {
      state: (r.accepted === recorded ? "pass" : "fail") as Result["state"],
      text: `Bought ${num(b.telegraph.value, 2)} vs public ${num(b.public_usd, 2)} recorded with it: ${rel} apart (limit ${TOL * 100}%). Rule says ${r.accepted ? "accept" : `reject (${r.reason})`}; the tape used the ${recorded ? "Telegraph" : "public"} price.`,
      detail: r.accepted === recorded ? "The tape's choice matches the rule." : "The tape's choice does not match the rule.",
    };
    setBtc(verdict);
    try {
      // Never delays or changes the verdict: give up quietly after 6 seconds.
      const live = await Promise.race([fetchBtcUsd(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 6000))]);
      const mins = Math.round((Date.now() - new Date(tape.recorded_at).getTime()) / 60000);
      const ref = b.public_usd ?? live;
      setBtc({ ...verdict, detail: `${verdict.detail} For context, mempool.space now says ${num(live, 2)} (${(((live - ref) / ref) * 100).toFixed(2)}% from the recorded public price, ${mins} min later; the market moves, so only the recorded pair is compared).` });
    } catch { /* live price is context only */ }
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
            <h3>1 · Recompute the 144-block mean (context)</h3>
            <p>Reads the last 144 blocks ending at block {num(t.block_height)} from mempool.space and averages reward-and-difficulty hashprice per block.</p>
            <button className="pill primary" onClick={() => recompute(t)} disabled={hp.state === "running"}>Recompute in my browser</button>
            <Verdict r={hp} />
          </section>

          <section className="card check">
            <h3>2 · Compare with the value Hushrate bought</h3>
            <p>Applies the agent's acceptance rule (fields ok, same block, within 1% of the public hashprice of that block) and checks the tape chose accordingly. Tapes from before 2026-11-14 are re-checked with the older 144-block rule and labelled legacy. Runs after step 1.</p>
            <Verdict r={cmp} />
          </section>

          <section className="card check">
            <h3>3 · Check the BTC price Hushrate bought</h3>
            <p>Applies the agent's BTC rule (call succeeded, price field ok, within 0.5% of the public mempool.space price recorded at the same moment) and checks the tape chose accordingly.</p>
            <button className="pill primary" onClick={() => checkBtc(t)} disabled={btc.state === "running"}>Check the BTC price</button>
            <Verdict r={btc} />
          </section>

          <section className="card check">
            <h3>4 · Check the payment on Sepolia</h3>
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
