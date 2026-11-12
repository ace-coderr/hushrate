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
        <button type="button" onClick={() => { document.getElementById("read")?.scrollIntoView(); }}>Read the desk</button>
        <button type="button" onClick={() => { document.getElementById("site")?.scrollIntoView(); }}>Add your site</button>
        <button type="button" onClick={() => { document.getElementById("verify")?.scrollIntoView(); }}>Verify a receipt</button>
        <button type="button" onClick={() => { document.getElementById("run")?.scrollIntoView(); }}>Run your own agent</button>
        <button type="button" onClick={() => { document.getElementById("limits")?.scrollIntoView(); }}>Limits</button>
        <button type="button" onClick={() => { document.getElementById("mcp")?.scrollIntoView(); }}>MCP</button>
      </nav>

      <article className="prose">
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
          <li>Open <a href="#/proof">Proof</a> and press Recompute. Your browser reads the last 144 blocks from mempool.space and rebuilds the hashprice.</li>
          <li>The page applies the agent's rule to the bought value: required fields ok, same block height, within 1% of your number.</li>
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
          <li><b>Hashprice is an average.</b> The public value is the mean over 144 blocks. A single block can be several percent higher or lower because of fees.</li>
          <li><b>Telegraph power price is not used.</b> It was tested and did not match CAISO, so CAISO OASIS supplies power prices. The probe report in the repository has the numbers.</li>
          <li><b>One node set.</b> The tape covers three CAISO trading hubs. A site on another node gets HOLD, not a guess.</li>
          <li><b>It does not control hardware.</b> Hushrate reports RUN, CURTAIL or HOLD; acting on it is yours.</li>
          <li><b>Not advice.</b> This is a decision aid, not financial advice, and it ignores ramp, restart and contract costs.</li>
        </ul>

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
