// Paid Telegraph requests over x402 (Ethereum Sepolia, test USDC only).
// Usage: tsx src/ask.ts [zone]        zone defaults to TH_SP15_GEN-APND
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { balances, WALLET, USDC } from "./wallet.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
try { process.loadEnvFile(`${ROOT}.env`); } catch { /* env may already be set */ }

const NODE = (process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, "");
const NETWORK = "eip155:11155111";
const MAX_PER_PAYMENT = "30000"; // 3 cents in 6-decimal test USDC
const MAX_PAID_CALLS = 4;
const RECEIPTS = `${ROOT}data/receipts`;

const key = process.env.EVM_PRIVATE_KEY;
if (!key) throw new Error("EVM_PRIVATE_KEY is not set (see .env.example)");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
if (account.address.toLowerCase() !== WALLET.toLowerCase()) {
  throw new Error(`Configured key controls ${account.address}, expected ${WALLET}. Refusing to pay.`);
}

// Transport-level guard: every request carrying a payment signature is counted, and a
// payment is never sent twice for the same logical call.
let paidAttempts = 0;
let currentCallPaid = false;
const guardedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (headers.has("payment-signature")) {
    if (currentCallPaid) throw new Error("Refusing second payment for the same call");
    if (paidAttempts >= MAX_PAID_CALLS) throw new Error(`Per-run limit of ${MAX_PAID_CALLS} paid calls reached`);
    paidAttempts++;
    currentCallPaid = true;
  }
  return fetch(input, init);
};

const fetchWithPayment = wrapFetchWithPaymentFromConfig(guardedFetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  spendControls: {
    allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: MAX_PER_PAYMENT }],
  },
});

function b64json(v: string | null): unknown {
  if (!v) return null;
  try { return JSON.parse(Buffer.from(v, "base64").toString("utf8")); } catch { return { undecodable: v }; }
}

interface Call { label: string; intent: string; params: Record<string, unknown>; }

function alreadyDone(c: Call): string | null {
  mkdirSync(RECEIPTS, { recursive: true });
  for (const f of readdirSync(RECEIPTS)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(`${RECEIPTS}/${f}`, "utf8"));
      if (r.paid && r.idempotency_key === JSON.stringify([c.intent, c.params])) return f;
    } catch { /* ignore unreadable file */ }
  }
  return null;
}

async function run(c: Call): Promise<void> {
  const prior = alreadyDone(c);
  if (prior) { console.log(`[${c.label}] already paid for identical request (${prior}); skipping.`); return; }
  currentCallPaid = false;
  console.log(`[${c.label}] POST ${NODE}/engine/v1/ask ${c.intent} ${JSON.stringify(c.params)}`);
  const res = await fetchWithPayment(`${NODE}/engine/v1/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: c.intent, params: c.params }),
  });
  const text = await res.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  const record = {
    label: c.label, intent: c.intent, params: c.params,
    idempotency_key: JSON.stringify([c.intent, c.params]),
    paid: currentCallPaid, http_status: res.status,
    payment_response: b64json(res.headers.get("payment-response")),
    telegraph_receipt: b64json(res.headers.get("x-telegraph-receipt")),
    response: body,
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`${RECEIPTS}/${ts}-${c.label}.json`, JSON.stringify(record, null, 2));
  console.log(`[${c.label}] HTTP ${res.status} paid=${currentCallPaid} -> data/receipts/${ts}-${c.label}.json`);
  console.log(JSON.stringify(body));
  if (res.status >= 400) throw new Error(`[${c.label}] failed with ${res.status}; not retrying`);
}

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
console.log(`  max paid calls this run: ${MAX_PAID_CALLS}; expected spend: $${(0.01 * calls.length).toFixed(2)}`);
const before = await balances();
console.log(`  wallet before: ${before.eth} ETH, ${before.usdc} USDC`);
if (Number(before.usdcRaw) < 10000 * calls.length) throw new Error("Insufficient test USDC");

let failed = false;
for (const c of calls) {
  try { await run(c); } catch (e) { failed = true; console.error(String(e)); }
}
const after = await balances();
console.log(`wallet after: ${after.eth} ETH, ${after.usdc} USDC (paid attempts: ${paidAttempts})`);
if (failed) process.exitCode = 1;
