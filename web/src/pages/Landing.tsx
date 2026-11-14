import { Fragment } from "react";
import { selectPower } from "@hushrate/core";
import { Empty, Reveal } from "../components/Layout";
import { Badge, DispatchTape, Stat } from "../components/Widgets";
import { useHistory, useLatest, useLedger } from "../lib/data";
import { decideWith, hourSlots, marketFromTape } from "../lib/decisions";
import { ago, hourLabel, num, usd } from "../lib/format";
import { useStore } from "../lib/store";

export function Landing() {
  const latest = useLatest();
  const history = useHistory();
  const ledger = useLedger();
  const { sites, isSample } = useStore();
  const t = latest.data;
  const billed = (ledger.data ?? []).reduce((a, r) => a + r.billed_usd, 0);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Power allocation for bitcoin miners</p>
          <h1>Run when the grid pays. <span className="amber">Hush when it doesn't.</span></h1>
          <p className="lede">Every hour Hushrate buys fresh market data, works out whether each site earns more than its power costs, and files a receipt you can check yourself.</p>
          <div className="cta-row">
            <a className="pill primary" href="#/desk">Open the desk</a>
            <a className="pill ghost" href="#/proof">Check a receipt</a>
          </div>
        </div>

        <div className="hero-card card" aria-live="polite">
          {latest.loading && <p className="muted">Loading the latest tape…</p>}
          {!latest.loading && !t && (
            <Empty title="No market tape published yet">The agent has not recorded an hour yet, so there is nothing real to show. Numbers appear here after the first run.</Empty>
          )}
          {t && (
            <>
              <div className="card-top">
                <div><p className="kicker">Latest real cycle</p><h3>{hourLabel(t.interval_start)}</h3></div>
                <span className="muted small">{ago(t.recorded_at)}</span>
              </div>
              <dl>
                <dt>Bitcoin block</dt><dd className="mono">{num(t.block_height)}</dd>
                <dt>Hashprice ({t.hashprice.source})</dt><dd className="mono">{num(t.hashprice.value_sats_per_ph_day)} sats/PH/day</dd>
                {t.power.map((p) => {
                  const s = selectPower(p);
                  return <Fragment key={p.node}><dt>{p.node.replace("TH_", "").replace("_GEN-APND", "")} {s.basis ?? ""}</dt><dd className="mono">{usd(s.usd_per_mwh, 2)}/MWh</dd></Fragment>;
                })}
              </dl>
              <p className="small muted tag-line">Decisions below use the {isSample ? "sample fleet (demo assumptions)" : "fleet you entered"}.</p>
              <ul className="mini-decisions">
                {sites.map((s) => {
                  const d = decideWith(s, marketFromTape(t, s.node));
                  return <li key={s.name}><span>{s.name}</span><Badge action={d.action} /></li>;
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      {t && (
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[0, 1].map((k) => (
              <span key={k}>
                <b>block {num(t.block_height)}</b> · hashprice {num(t.hashprice.value_sats_per_ph_day)} sats/PH/day · BTC {usd(t.btc_usd)} ·{" "}
                {t.power.map((p) => `${p.node.replace("TH_", "").replace("_GEN-APND", "")} ${usd(selectPower(p).usd_per_mwh, 2)}/MWh`).join(" · ")} ·{" "}
              </span>
            ))}
          </div>
        </div>
      )}

      <Reveal>
        <section className="band">
          <h2>The last 24 hours, one cell per hour</h2>
          <DispatchTape slots={hourSlots(history.data ?? [])} site={sites[0] ?? null} />
          <p className="small muted">{isSample ? "Shown for the sample fleet's first site. " : ""}Cells fill in as hourly tapes are recorded; hours without a tape stay grey.</p>
        </section>
      </Reveal>

      <Reveal>
        <section className="stats" aria-label="What has been recorded so far">
          <Stat value={num(history.data?.length ?? 0)} label="hourly market tapes" sub="recorded by the agent" />
          <Stat value={num(ledger.data?.length ?? 0)} label="paid data requests" sub="each with a Sepolia payment" />
          <Stat value={`$${billed.toFixed(2)}`} label="test USDC billed" sub="testnet only, no real money" />
        </section>
      </Reveal>

      <Reveal>
        <section className="steps">
          <h2>Three steps, every hour</h2>
          <div className="grid3">
            {[
              ["01", "Buy", "The agent pays $0.01 in test USDC over x402 for a hashprice reading from the Telegraph network, and pulls public power prices from CAISO for each pricing node."],
              ["02", "Decide", "Your site's load, efficiency and power adder meet the market in your own browser. Revenue minus power cost gives a margin, and the margin gives RUN or CURTAIL."],
              ["03", "Receipt", "The paid reading is checked against the same quantity computed from public chain data. The receipt hash and the Sepolia payment are filed so anyone can repeat the check."],
            ].map(([n, h, p], i) => (
              <Reveal key={n} delay={i * 90}><article className="card step"><span className="mono step-n">{n}</span><h3>{h}</h3><p>{p}</p></article></Reveal>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="proof">
          <h2>Proof you can check</h2>
          <div className="grid6">
            {[
              ["#/proof", "Recompute the hashprice", "Your browser re-reads the block from mempool.space, recomputes its hashprice and compares it with the bought value."],
              ["#/proof", "Read the payment on chain", "Each paid request points to a Sepolia transaction. Look it up on a public RPC and see the USDC transfer."],
              ["#/receipts", "Every paid request, listed", "Cost, miner, receipt hash and transaction hash for each request, with explorer links."],
              ["#/desk", "Two power prices, labelled", "Real-time CAISO when it exists, day-ahead otherwise, and the label says which one decided."],
              ["#/docs", "Decision math you can read", "A small shared package with hand-computed tests runs the agent, this site and the MCP tool."],
              ["#/desk", "Missing input means HOLD", "No price, no decision. Hushrate never fills a gap with a guess."],
            ].map(([href, h, p], i) => (
              <Reveal key={h} delay={i * 60}><a className="card proof-card" href={href}><h3>{h}</h3><p>{p}</p><span className="arrow" aria-hidden="true">→</span></a></Reveal>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="faq">
          <h2>Questions</h2>
          {[
            ["Is this real money?", "No. Payments are Ethereum Sepolia test USDC at $0.01 per request. Nothing here touches mainnet."],
            ["Where do my site numbers go?", "Nowhere. Sites live in your browser's local storage and decisions are computed in the page. The published files hold market data only."],
            ["Why not use Telegraph for the power price?", "In the tests recorded in the probe report, the one miner that answered was about $29/MWh away from CAISO for the same hour and node, so Hushrate uses CAISO directly and says so."],
            ["What does real-time versus day-ahead change?", "Real-time prices move every five minutes and can differ a lot from the day-ahead price. Hushrate uses real-time when CAISO has it and labels which one decided."],
            ["Does it switch my machines?", "No. It tells you RUN, CURTAIL or HOLD with the numbers behind it. Acting on that is up to your own controls."],
          ].map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </section>
      </Reveal>

      <Reveal>
        <section className="closing card">
          <h2>See what this hour is worth to your site.</h2>
          <p>Enter your load and efficiency, and the desk shows RUN, CURTAIL or HOLD with the breakeven price.</p>
          <div className="cta-row"><a className="pill primary" href="#/sites">Add your site</a><a className="pill ghost" href="#/whatif">Try the what-if</a></div>
        </section>
      </Reveal>
    </>
  );
}
