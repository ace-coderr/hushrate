// Shared capped x402 client (Ethereum Sepolia, test USDC only).
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { WALLET, USDC } from "./wallet.js";
import { loadNetwork } from "./network.js";
import { keyOf, settledReceipt } from "./dedupe.js";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
try { process.loadEnvFile(`${ROOT}.env`); } catch { /* env may already be set */ }

const net = loadNetwork();
export const NODE = net.telegraph_node;
export const NETWORK = net.caip2;
export const MAX_PER_PAYMENT = net.max_amount_per_payment; // 30000 = 3 cents in 6-decimal USDC on Sepolia
export const MAX_PAID_CALLS = net.max_paid_calls_per_run;
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
export const paidCount = () => paidAttempts;
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

/**
 * `dedupe` makes the duplicate-request key unique per period for requests whose params never change (the BTC price has
 * params {symbol: "BTC"} forever, so without it the second purchase ever would be skipped as a duplicate of the first).
 */
export interface Call { label: string; intent: string; params?: Record<string, unknown>; query?: string; minerId?: string; dedupe?: string; }


function alreadyDone(c: Call): string | null {
  mkdirSync(RECEIPTS, { recursive: true });
  for (const f of readdirSync(RECEIPTS)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(`${RECEIPTS}/${f}`, "utf8"));
      // Receipts written before direct calls existed have no miner id in the key.
      const legacy = JSON.stringify([c.intent, c.params]);
      if (settledReceipt(r) && (r.idempotency_key === keyOf(c) || (!c.minerId && r.idempotency_key === legacy))) return f;
    } catch { /* ignore unreadable file */ }
  }
  return null;
}

export interface Outcome { skipped?: string; /** receipt file name, set for both new and skipped calls */ receipt_file?: string; status?: number; paid?: boolean; body?: any; file?: string; }

/** Runs one call. Never retries. Records a receipt for anything that was paid. */
export async function run(c: Call): Promise<Outcome> {
  const prior = alreadyDone(c);
  if (prior) { console.log(`[${c.label}] already paid for identical request (${prior}); skipping.`); return { skipped: prior, receipt_file: prior }; }
  currentCallPaid = false;
  const url = `${NODE}/engine/v1/ask${c.minerId ? `/${encodeURIComponent(c.minerId)}` : ""}`;
  console.log(`[${c.label}] POST ${url} ${c.intent} ${JSON.stringify(c.params ?? c.query)}`);
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  let res: Response;
  try {
    res = await fetchWithPayment(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: c.intent, ...(c.params ? { params: c.params } : {}), ...(c.query ? { query: c.query } : {}) }),
    });
  } catch (e) {
    // If a payment was already signed and sent, record it so a re-run never pays twice.
    if (currentCallPaid) {
      writeFileSync(`${RECEIPTS}/${stamp()}-${c.label}.json`, JSON.stringify({
        label: c.label, miner_id_requested: c.minerId ?? null, intent: c.intent, params: c.params ?? null, query: c.query ?? null,
        idempotency_key: keyOf(c), paid: true, http_status: null, error: String(e),
      }, null, 2));
    }
    throw e;
  }
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  const file = `${stamp()}-${c.label}.json`;
  // Unpaid refusals (400/402/404/503 before settlement) carry no receipt; keep them out of the ledger.
  const record = {
    label: c.label, miner_id_requested: c.minerId ?? null, intent: c.intent, params: c.params ?? null, query: c.query ?? null,
    idempotency_key: keyOf(c), paid: currentCallPaid, http_status: res.status,
    payment_response: b64json(res.headers.get("payment-response")),
    telegraph_receipt: b64json(res.headers.get("x-telegraph-receipt")),
    response: body,
  };
  writeFileSync(`${RECEIPTS}/${file}`, JSON.stringify(record, null, 2));
  console.log(`[${c.label}] HTTP ${res.status} paid=${currentCallPaid} -> data/receipts/${file}`);
  return { status: res.status, paid: currentCallPaid, body, file, receipt_file: file };
}

export function readReceipt(file: string): any {
  return JSON.parse(readFileSync(`${RECEIPTS}/${file}`, "utf8"));
}
