import { PageHead } from "../components/Layout";

const mcpConfig = `{
  "mcpServers": {
    "hushrate": {
      "command": "node",
      "args": ["/absolute/path/to/hushrate/packages/mcp/dist/index.js"]
    }
  }
}`;

export function Docs() {
  return (
    <>
      <PageHead kicker="Docs" title="Use it, check it, run your own.">
        A short tutorial, the limits in plain language, and how to plug Hushrate into an MCP client.
      </PageHead>

      <nav className="toc" aria-label="On this page">
        <button type="button" onClick={() => { document.getElementById("commercial")?.scrollIntoView(); }}>Commercial case</button>
        <button type="button" onClick={() => { document.getElementById("acceptance")?.scrollIntoView(); }}>Data acceptance</button>
        <button type="button" onClick={() => { document.getElementById("read")?.scrollIntoView(); }}>Read the desk</button>
        <button type="button" onClick={() => { document.getElementById("site")?.scrollIntoView(); }}>Add your site</button>
        <button type="button" onClick={() => { document.getElementById("verify")?.scrollIntoView(); }}>Verify a receipt</button>
        <button type="button" onClick={() => { document.getElementById("run")?.scrollIntoView(); }}>Run your own agent</button>
        <button type="button" onClick={() => { document.getElementById("limits")?.scrollIntoView(); }}>Limits</button>
        <button type="button" onClick={() => { document.getElementById("mainnet")?.scrollIntoView(); }}>Path to mainnet</button>
        <button type="button" onClick={() => { document.getElementById("mcp")?.scrollIntoView(); }}>MCP</button>
      </nav>

      <article className="prose">
        <h2 id="commercial">The commercial case</h2>
        <p>Five questions, answered plainly. Nothing below is a measured result, a customer claim or a promised saving: the product is a testnet prototype, and any dollar figure shown with the sample fleet is arithmetic on labelled demo assumptions.</p>

        <h3>1 · Who is it for?</h3>
        <p>Bitcoin miners and compute operators whose power is priced by the hour or by the five minutes at a wholesale node, and who decide each hour whether a site should run or curtail. Today that means sites that settle against a CAISO node, since that is the market the tape covers.</p>

        <h3>2 · What does it improve?</h3>
        <p>It replaces a manual, per-person check with one repeatable calculation per site, every hour: revenue from the current hashprice and BTC price, minus the energy bill at the current power price plus your own adder, giving RUN, CURTAIL or HOLD and the power price at which the answer flips (the breakeven). The improvement is consistency and auditability: every input has a source label, the paid inputs are checked against public data, and each purchase has a receipt anyone can look up. It does not claim a dollar saving.</p>

        <h3>3 · What does it do today?</h3>
        <ul>
          <li>Records an hourly market tape: hashprice and BTC/USD bought from the Telegraph network (each accepted only if it verifies against mempool.space), plus CAISO real-time and day-ahead prices for three nodes.</li>
          <li>Computes decisions in your browser from your own site inputs, with a what-if calculator, a 24-hour dispatch tape and a ledger of every paid request.</li>
          <li>Lets you re-verify a tape yourself: recompute the hashprice of the bought block, re-apply the BTC rule, check the payment transaction on Sepolia.</li>
          <li>Exposes the same data and decision math to AI agents through an MCP server.</li>
          <li>Runs hourly without anyone watching, and pauses itself if the test-USDC balance runs low.</li>
        </ul>
        <p>It runs on Ethereum Sepolia with test USDC only. It does not switch hardware, and it has no customers or measured savings to report.</p>

        <h3>4 · Why would someone adopt it?</h3>
        <ul>
          <li><b>Your numbers stay yours.</b> Sites live in your browser's local storage; the published files hold market data only.</li>
          <li><b>You do not have to trust it.</b> The Proof page recomputes the inputs and checks the payment on a public chain.</li>
          <li><b>The data is cheap relative to the decision.</b> One tape serves any number of sites, so the data cost does not grow with your fleet (table below).</li>
          <li><b>It is open and scriptable.</b> The decision math is a small tested package, and an MCP tool lets an agent ask the same question.</li>
        </ul>
        <p>The honest caveat: whether the economics hold for a real operator is untested here. The first step to find out is to enter your real sites and read a few days of decisions against what you actually did.</p>

        <h3>5 · How can I try it?</h3>
        <ol>
          <li>Open <a href="#/sites">Sites</a>, replace the sample fleet with your load (MW), efficiency (J/TH), pricing node and power adder.</li>
          <li>Open the <a href="#/desk">Desk</a> for this hour's decision and breakeven, and the 24-hour tape as it fills.</li>
          <li>Move the inputs on <a href="#/whatif">What-if</a> to see where RUN turns into CURTAIL.</li>
          <li>Check a tape on <a href="#/proof">Proof</a>, or run the agent yourself with a test wallet (see below).</li>
        </ol>

        <h3>What the intelligence costs</h3>
        <p>Hushrate's only running cost is the data it buys. CAISO and mempool.space are free. Test-USDC figures at $0.01 per request:</p>
        <div className="scroll">
          <table>
            <thead><tr><th>Item</th><th>Requests</th><th>Cost</th></tr></thead>
            <tbody>
              <tr><td>Hashprice (Telegraph, pinned miner)</td><td className="mono">1 per hour</td><td className="mono">$0.01</td></tr>
              <tr><td>BTC/USD price (Telegraph, pinned miner)</td><td className="mono">1 per hour</td><td className="mono">$0.01</td></tr>
              <tr><td>CAISO prices, mempool.space</td><td className="mono">free</td><td className="mono">$0.00</td></tr>
              <tr><td><b>Per hourly run</b></td><td className="mono">2</td><td className="mono"><b>$0.02</b></td></tr>
              <tr><td><b>Per day (24 runs)</b></td><td className="mono">48</td><td className="mono"><b>$0.48</b></td></tr>
              <tr><td>To 1 December (19 days)</td><td className="mono">912</td><td className="mono">$9.12</td></tr>
              <tr><td>Per 30 days</td><td className="mono">1,440</td><td className="mono">$14.40</td></tr>
              <tr><td>Per extra site</td><td className="mono">0</td><td className="mono">$0.00</td></tr>
            </tbody>
          </table>
        </div>
        <p>Safety limits: at most 3 paid calls per run, at most 3 cents per payment, and the agent pauses below 0.20 test USDC. The live total is on <a href="#/receipts">Receipts</a>.</p>

        <h2 id="acceptance">Data acceptance</h2>
        <p>Hushrate buys a hashprice reading every hour and uses it only if it passes a check against public chain data. This is how often the Telegraph miner passed, what the check is, and what happens when it does not.</p>
        <div className="scroll">
          <table>
            <thead><tr><th>Period</th><th>Purchases</th><th>Accepted by the old rule (within 1% of the 144-block mean)</th><th>Within 1% of the public value of the block the miner returned</th></tr></thead>
            <tbody>
              <tr><td>2026-11-12 16:10 to 2026-11-14 07:17 UTC</td><td className="mono">38</td><td className="mono">29 of 38 (76.3%)</td><td className="mono">38 of 38 (100%)</td></tr>
              <tr><td>Last 24 hours (2026-11-13 07:17 to 2026-11-14 07:17 UTC)</td><td className="mono">26</td><td className="mono">17 of 26 (65.4%)</td><td className="mono">26 of 26 (100%)</td></tr>
            </tbody>
          </table>
        </div>
        <ul>
          <li><b>What the diagnosis found.</b> The miner computes the hashprice of one block, the latest, and matched the public value of that block exactly in every purchase (median difference 0.00%). The old rule compared it with a 144-block mean. After the difficulty adjustment at block 975744 (-9.13%) that mean mixed two difficulty regimes and sat about 9% low for a day, so accurate values were rejected; the remaining rejections were ordinary single-block fee noise of 1.05% to 1.78%. The miner's data was not wrong.</li>
          <li><b>The rule now.</b> The bought value must come from a successful call with the fields we use marked ok, for the block we asked about, and be within 1% of the public hashprice of that same block, which your browser recomputes on the Proof page. The 1% limit was not widened. The right-hand column is that rule replayed on the recorded data; the live rate will be added as hours accumulate.</li>
          <li><b>The fallback.</b> If the Telegraph value is unavailable or fails, the public value of the latest block is used, with the same definition, and the tape says why. A second miner is tried only when the first signed no payment, so hashprice is never bought twice in one hour.</li>
          <li><b>Old tapes</b> keep the rule they were recorded under, and Proof re-applies that rule to them.</li>
        </ul>
        <p>The full table, the hypotheses tested (different window, different fee definition, lag, fee spikes) and the evidence are in <code>docs/hashprice-drift.md</code> in the repository.</p>

        <h2 id="read">How to read the desk</h2>
        <ul>
          <li><b>Stat trio.</b> Hashprice (what one PH/s earns per day), the BTC price used to turn sats into dollars, and the Bitcoin block the tape was recorded at.</li>
          <li><b>Power table.</b> One row per CAISO node. Real-time is the latest five-minute price; day-ahead is the hourly auction price. Decisions use real-time when CAISO has it and day-ahead otherwise, and the last column says which.</li>
          <li><b>Dispatch tape.</b> One cell per UTC hour for the site you pick. Amber is RUN, cyan is CURTAIL, grey is HOLD. Grey means the hour has no tape or an input was missing, never a guessed value.</li>
          <li><b>Site cards.</b> Revenue minus power cost is the daily margin. The bar shows today's power price against the breakeven price, which is the price at which margin hits your minimum.</li>
        </ul>

        <h2 id="site">Add your site</h2>
        <ol>
          <li>Open <a href="#/sites">Sites</a>. The sample fleet is only a demo, so replace it.</li>
          <li>Enter load in MW, fleet efficiency in J/TH (the miner spec sheet lists it), the pricing node, and a power adder in $/MWh for delivery, fees and overhead.</li>
          <li>Press Save. Your sites are kept in this browser's local storage and are never uploaded. Use Export JSON to back them up or move them to another browser.</li>
        </ol>
        <p>Hashrate is derived as load divided by efficiency, and energy per day is load times 24 hours. That is the whole model.</p>

        <h2 id="verify">Verify a receipt</h2>
        <ol>
          <li>Open <a href="#/proof">Proof</a> and press Recompute. Your browser reads the last 144 blocks from mempool.space and rebuilds the 144-block mean (context).</li>
          <li>The page applies the agent's rule to the bought value: required fields ok, same block height, within 1% of the public hashprice of that same block, which it recomputes from the block's reward and difficulty. Tapes recorded before 2026-11-14 are checked with the rule they were recorded under (the 144-block mean) and labelled as legacy.</li>
          <li>Pick a payment and press Check on Sepolia. A public RPC returns the transaction and the page finds the test-USDC transfer from the payer.</li>
          <li><a href="#/receipts">Receipts</a> lists every paid request with its receipt hash and an explorer link, so you can also check by hand.</li>
        </ol>

        <h2 id="run">Run your own agent</h2>
        <pre><code>{`git clone https://github.com/ace-coderr/hushrate.git
cd hushrate
npm install
cp .env.example .env      # set EVM_PRIVATE_KEY to a Sepolia TEST wallet
npm run wallet            # check test ETH and test USDC
npm run agent -- --no-pay # free: public sources only
npm run agent             # buys one hashprice reading, writes data/`}</code></pre>
        <p>Test USDC can be minted on Sepolia with <code>mint(address,uint256)</code> on 0xcc194e1a843B658526D0D5C431f670028582Ae17. The agent pays at most 3 cents per payment, at most 3 paid calls per run, never retries a settled payment, and pauses if the balance falls under 0.20 test USDC.</p>

        <h2 id="repro">Reproduce the build</h2>
        <pre><code>{`npm test                    # decision math, hand-computed
npm run typecheck
npm run build -w web        # static site in web/dist
npm run build -w packages/mcp`}</code></pre>

        <h2 id="limits">Limits, in plain language</h2>
        <ul>
          <li><b>Testnet only.</b> Payments are Sepolia test USDC. Nothing touches mainnet or real money.</li>
          <li><b>Sample fleet.</b> The default sites are demo assumptions. Decisions are only as good as the load, efficiency and adder you enter.</li>
          <li><b>Day-ahead versus real-time.</b> Real-time prices swing from interval to interval. Hushrate uses the latest published five-minute price and labels it; it is not a forecast.</li>
          <li><b>Hashprice is one block.</b> The value used is the hashprice of the latest block, so it includes that block's fees and can sit a percent or two away from the 144-block mean the tape keeps for context. After a difficulty adjustment it follows the new difficulty immediately, which an average would not.</li>
          <li><b>Telegraph power price is not used.</b> It was tested and did not match CAISO, so CAISO OASIS supplies power prices. The probe report in the repository has the numbers.</li>
          <li><b>One node set.</b> The tape covers three CAISO trading hubs. A site on another node gets HOLD, not a guess.</li>
          <li><b>One pinned miner per paid intent.</b> The BTC price and hashprice each come from one miner, chosen from a small probe. If it fails, the public value is used and labelled.</li>
          <li><b>No backtest, no customers.</b> There is no measured saving and no adoption to report; the figures with the sample fleet are example arithmetic.</li>
          <li><b>It does not control hardware.</b> Hushrate reports RUN, CURTAIL or HOLD; acting on it is yours.</li>
          <li><b>Not advice.</b> This is a decision aid, not financial advice, and it ignores ramp, restart and contract costs.</li>
        </ul>

        <h2 id="mainnet">Path to mainnet (not live)</h2>
        <p><b>Hushrate is NOT live on mainnet.</b> Every payment today is Ethereum Sepolia test USDC. Telegraph's published documentation lists testnet addresses only, so this repository contains no mainnet addresses and none were invented.</p>
        <p>What exists in code: network settings live in <code>config/networks.json</code>. <code>sepolia</code> is the active network. A <code>mainnet</code> entry exists but is <b>disabled</b>, with every value set to null on purpose. The loader (<code>agent/src/network.ts</code>) refuses to run a non-testnet network unless all three hold: it is switched on in the file, every address, node, limit and RPC value is filled in explicitly (nothing is defaulted), and the environment carries <code>HUSHRATE_MAINNET_ENABLE=I_UNDERSTAND_THIS_USES_REAL_MONEY</code>. Tests cover each refusal. The mint script refuses to run on any non-testnet network.</p>
        <p>Checklist before anyone flips it:</p>
        <ol>
          <li><b>Addresses from Telegraph.</b> The mainnet node URL, the settlement asset address, the payee and the chain's CAIP-2 id, from Telegraph's own documentation or team, never from this repo or a guess.</li>
          <li><b>A real USDC budget and caps.</b> Set a small total budget, <code>max_amount_per_payment</code> and <code>max_paid_calls_per_run</code> in the config, and a <code>min_balance_units</code> floor. Recompute the cost table at real prices.</li>
          <li><b>Key custody.</b> A dedicated low-balance hot wallet used for this agent only. A repository secret is acceptable for a testnet key, not long term for a funded one: move to a secrets manager, a short-lived signing service or a smart wallet with a spending limit.</li>
          <li><b>Alerts.</b> A notification when the hourly chain stalls (the Settings page already shows the ticker and last successful run) and when the balance falls near the floor, so a stalled agent does not silently serve stale data.</li>
          <li><b>Re-verify everything.</b> Re-run the miner probes on mainnet (miner ids and scores differ per network), re-check the acceptance tolerances, re-test the same-hour and duplicate-payment guards with real settlement, confirm what happens to a payment whose request fails upstream, and re-read Telegraph's terms for production use.</li>
          <li><b>Scope the claims.</b> Until all of the above is done and checked, keep the site labelled testnet only.</li>
        </ol>
        <p>The same list is in the repository as <code>docs/mainnet.md</code>.</p>

        <h2 id="mcp">MCP setup</h2>
        <p>The MCP server reads the published JSON on this site, so it needs no key and no wallet. Build it once, then point your MCP client at it.</p>
        <pre><code>{`npm install
npm run build -w packages/mcp`}</code></pre>
        <p>Add it to your client's config (for example Claude Desktop's <code>claude_desktop_config.json</code>), using the real absolute path:</p>
        <pre><code>{mcpConfig}</code></pre>
        <ul>
          <li><code>hushrate_market</code>: the latest market tape.</li>
          <li><code>hushrate_decide</code>: give it a site (load MW, efficiency J/TH, power adder, node, minimum margin) and it returns RUN, CURTAIL or HOLD with the breakeven price.</li>
          <li><code>hushrate_receipts</code>: the ledger of paid requests with receipt and transaction hashes.</li>
        </ul>
        <p>Set <code>HUSHRATE_DATA_URL</code> to read from a different copy of the data folder.</p>
      </article>
    </>
  );
}
