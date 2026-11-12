// Paid, router-chosen Telegraph requests over x402 (Ethereum Sepolia, test USDC only).
// Usage: tsx src/ask.ts [zone]        zone defaults to TH_SP15_GEN-APND
import { run, paidCount, MAX_PAID_CALLS, MAX_PER_PAYMENT, type Call } from "./x402.js";
import { balances } from "./wallet.js";

const zone = process.argv[2] ?? "TH_SP15_GEN-APND";
const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
const heightRes = await fetch("https://mempool.space/api/blocks/tip/height");
if (!heightRes.ok) throw new Error(`mempool.space height fetch failed: ${heightRes.status}`);
const height = Number((await heightRes.text()).trim());
if (!Number.isInteger(height) || height <= 0) throw new Error("Invalid block height from mempool.space");

const calls: Call[] = [
  { label: "A-grid-power", intent: "GRID_POWER_PRICE_GENERAL", params: { node_or_zone: zone, interval_start: hour.toISOString().replace(".000Z", "Z") } },
  { label: "B-hashprice", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: height } },
];

console.log("Cost table (Ethereum Sepolia, test USDC, no real money)");
console.log("  call                         price/call     cap/payment");
for (const c of calls) console.log(`  ${c.label.padEnd(28)} $0.01 (10000)  $0.03 (${MAX_PER_PAYMENT})`);
console.log(`  max paid calls this run: ${MAX_PAID_CALLS}; worst-case expected spend: $${(0.01 * calls.length).toFixed(2)}`);
const before = await balances();
console.log(`  wallet before: ${before.eth} ETH, ${before.usdc} USDC`);
if (Number(before.usdcRaw) < 10000 * calls.length) throw new Error("Insufficient test USDC");

let failed = false;
for (const c of calls) {
  try {
    const o = await run(c);
    if (o.body) console.log(JSON.stringify(o.body));
    if (o.status && o.status >= 400) throw new Error(`[${c.label}] failed with ${o.status}; not retrying`);
  } catch (e) { failed = true; console.error(String(e)); }
}
const after = await balances();
console.log(`wallet after: ${after.eth} ETH, ${after.usdc} USDC (paid attempts: ${paidCount()})`);
if (failed) process.exitCode = 1;
