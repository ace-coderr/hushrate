// Shared capped x402 client. Pays only the pinned asset on the pinned network to the pinned payee (config/networks.json).
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { WALLET, USDC } from "./wallet.js";
import { loadNetwork } from "./network.js";
import { keyOf, settledReceipt } from "./dedupe.js";
import { describeRefusal, isAllowedPayment, type PaymentChallengeOption } from "@hushrate/core";

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

/** What Hushrate will pay: exactly this asset, on this network, to this payee. Anything else is refused before signing. */
export const PINNED = { network: net.caip2 as string, asset: USDC as string, payTo: net.pay_to as string };

// The last 402 challenge the node sent. Kept so a refusal can say what the miner asked for (asset and network).
let lastChallenge: PaymentChallengeOption[] | null = null;
const guardedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (headers.has("payment-signature")) {
    if (currentCallPaid) throw new Error("Refusing second payment for the same call");
    if (paidAttempts >= MAX_PAID_CALLS) throw new Error(`Per-run limit of ${MAX_PAID_CALLS} paid calls reached`);
    paidAttempts++;
    currentCallPaid = true;
  }
  const res = await fetch(input, init);
  if (res.status === 402) {
    try {
      const h = res.headers.get("payment-required");
      if (h) lastChallenge = (JSON.parse(Buffer.from(h, "base64").toString("utf8")).accepts ?? []) as PaymentChallengeOption[];
    } catch { /* an unreadable challenge is reported as such */ }
  }
  return res;
};

const fetchWithPayment = wrapFetchWithPaymentFromConfig(guardedFetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  // Spend controls: only the pinned asset, capped per payment. Never allowedAssets: true and never spendControls: false.
  spendControls: {
    allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: MAX_PER_PAYMENT }],
  },
  // Policy (runs after spend controls): also pin the payee, the network and the scheme.
  policies: [(_version, reqs) => reqs.filter((r) => isAllowedPayment(r as unknown as PaymentChallengeOption, PINNED))],
});

/** Turn the client's generic refusal into a specific one that names the asset and network the miner asked for. */
function loudRefusal(e: unknown): Error | null {
  const m = e instanceof Error ? e.message : String(e);
  if (!/Failed to create payment payload|rejected by spendControls|No payment requirements/i.test(m)) return null;
  return new Error(describeRefusal(lastChallenge, PINNED));
}

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
  } catch (e0) {
    const e = loudRefusal(e0) ?? e0;
    // If a payment was already signed and sent, record it so a re-run never pays twice.
    if (currentCallPaid) {
      writeFileSync(`${RECEIPTS}/${stamp()}-${c.label}.json`, JSON.stringify({
        label: c.label, miner_id_requested: c.minerId ?? null, intent: c.intent, params: c.params ?? null, query: c.query ?? null,
        idempotency_key: keyOf(c), paid: true, http_status: null, error: String(e),
        payment: { asset: PINNED.asset, network: PINNED.network, pay_to: PINNED.payTo },
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
    // The asset this call was allowed to pay with. Receipts written before 2026-11-17 have no such field (the previous asset).
    payment: { asset: PINNED.asset, network: PINNED.network, pay_to: PINNED.payTo },
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
