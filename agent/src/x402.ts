// Shared capped x402 client. Pays only assets on an explicit allow-list (config/networks.json), each to its own pinned payee.
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { WALLET, ASSETS } from "./wallet.js";
import { loadNetwork } from "./network.js";
import { ledgerAccount } from "./ledgeracct.js";
import { keyOf, settledReceipt } from "./dedupe.js";
import {
  describeRefusal, isAllowedPayment, selectPayment, checkEscrowOffer, escrowFunding, buildEscrowRequest, encodeEscrowPayment, decodeEscrowReceipt, escrowReceiptMatches,
  type PaymentChallengeOption, type PaymentPin, type EscrowOption, type EscrowPin, type EscrowReceipt, type Rail,
} from "@hushrate/core";

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

/**
 * What Hushrate will pay: exactly these (network, asset, payee) triples. The node decides which of them it asks for;
 * any other asset, payee, network or scheme is refused before anything is signed.
 */
export const PINS: PaymentPin[] = ASSETS.map((a) => ({ network: net.caip2 as string, asset: a.address as string, payTo: a.pay_to as string, symbol: a.symbol, decimals: a.decimals }));

/** The escrow rail: only this Diamond on this network, or the rail is off. */
export const ESCROW_PIN: EscrowPin | null = net.escrow ? { network: net.caip2 as string, diamond: net.escrow.diamond } : null;
const CAP_UNITS = BigInt(MAX_PER_PAYMENT);

/** Which rails this run may use. The agent narrows it after its own assessment; the default allows both (escrow first). */
export interface Rails { escrow: boolean; exact: boolean; }
let rails: Rails = { escrow: !!ESCROW_PIN, exact: true };
export const setRails = (r: Partial<Rails>) => { rails = { escrow: (r.escrow ?? rails.escrow) && !!ESCROW_PIN, exact: r.exact ?? rails.exact }; };

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
  // Only the challenge that answers a request WITHOUT payment: the 402 that follows a payment is a settlement failure, not terms.
  if (res.status === 402 && !headers.has("payment-signature")) {
    try {
      const h = res.headers.get("payment-required");
      if (h) lastChallenge = (JSON.parse(Buffer.from(h, "base64").toString("utf8")).accepts ?? []) as PaymentChallengeOption[];
    } catch { /* an unreadable challenge is reported as such */ }
  }
  return res;
};

const fetchWithPayment = wrapFetchWithPaymentFromConfig(guardedFetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  // Spend controls: only the allow-listed assets, each capped per payment. Never allowedAssets: true and never spendControls: false.
  spendControls: {
    allowedAssets: PINS.map((p) => ({ network: NETWORK, asset: p.asset, maxAmountPerPayment: MAX_PER_PAYMENT })),
  },
  // Policy (runs after spend controls): also require the payee pinned for that asset, the network and the scheme.
  policies: [(_version, reqs) => reqs.filter((r) => isAllowedPayment(r as unknown as PaymentChallengeOption, PINS))],
});

/** What an escrow payment is recorded against: the Diamond on this network, funded in the escrow token. */
function escrowPayment(): { rail: "escrow"; asset: string; network: string; pay_to: string } {
  return { rail: "escrow", asset: net.escrow!.token, network: NETWORK, pay_to: net.escrow!.diamond };
}

/** The asset, network and payee the payment client selects from the last challenge (null if none is allowed). */
function selectedPayment(): { asset: string; network: string; pay_to: string } | null {
  const sel = selectPayment(lastChallenge, PINS);
  return sel ? { asset: sel.pin.asset, network: sel.pin.network, pay_to: sel.pin.payTo } : null;
}

/**
 * Read the node's payment terms WITHOUT paying: a request with no payment header returns the 402 challenge. Used before
 * a run so the funding check applies to the asset the node actually asks for.
 */
export async function previewChallenge(minerId: string, intent: string, params: Record<string, unknown>): Promise<PaymentChallengeOption[] | null> {
  const res = await fetch(`${NODE}/engine/v1/ask/${encodeURIComponent(minerId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, params }), signal: AbortSignal.timeout(30000),
  });
  if (res.status !== 402) return null; // refused before payment (400, 404, 503) or not payable: nothing to read
  const h = res.headers.get("payment-required");
  if (!h) return null;
  try { return (JSON.parse(Buffer.from(h, "base64").toString("utf8")).accepts ?? []) as PaymentChallengeOption[]; } catch { return null; }
}

/** Turn the client's generic refusal into a specific one that names the asset and network the miner asked for. */
function loudRefusal(e: unknown): Error | null {
  const m = e instanceof Error ? e.message : String(e);
  if (!/Failed to create payment payload|rejected by spendControls|No payment requirements/i.test(m)) return null;
  return new Error(describeRefusal(lastChallenge, PINS));
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
  const reqBody = JSON.stringify({ intent: c.intent, ...(c.params ? { params: c.params } : {}), ...(c.query ? { query: c.query } : {}) });
  let res: Response;
  let rail: Rail = "exact";
  let escrowSent: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string } | null = null;
  let escrowAvailableBefore: string | null = null;
  let escrowRefusal: string | null = null; // an unbilled escrow refusal, kept so the receipt says why exact was used afterwards
  try {
    let viaEscrow: Response | null = null;
    if (rails.escrow && ESCROW_PIN) {
      const resource = `/v1/ask${c.minerId ? `/${encodeURIComponent(c.minerId)}` : ""}`;
      // Free: a request with no payment returns the 402 challenge, which carries the escrow terms for THIS resource.
      const pre = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody, signal: AbortSignal.timeout(30000) });
      if (pre.status !== 402) {
        viaEscrow = pre; // refused before payment (400, 404, 503) or not payable: record it as it is, pay nothing
      } else {
        let accepts: (EscrowOption & PaymentChallengeOption)[] = [];
        try { const h = pre.headers.get("payment-required"); accepts = JSON.parse(h ? Buffer.from(h, "base64").toString("utf8") : await pre.text()).accepts ?? []; } catch { /* unreadable: treated as no escrow entry */ }
        lastChallenge = accepts as PaymentChallengeOption[];
        const offer = checkEscrowOffer(accepts, ESCROW_PIN, CAP_UNITS, resource);
        if (offer.state === "refused") {
          if (!rails.exact) throw new Error(offer.reason);
          escrowRefusal = offer.reason;
        } else if (offer.state === "ok") {
          const led = await ledgerAccount();
          const f = escrowFunding(led?.available, offer.amount);
          escrowAvailableBefore = led ? led.available.toString() : null;
          if (f.state === "unknown") throw new Error("escrow balance unknown: not falling back to settlement without knowing the balance");
          if (f.state === "unfunded") {
            escrowRefusal = `escrow unfunded: ${f.available} uUSDC available, ${f.needed} needed`;
            if (!rails.exact) throw new Error(escrowRefusal);
          } else {
            if (paidAttempts >= MAX_PAID_CALLS) throw new Error(`Per-run limit of ${MAX_PAID_CALLS} paid calls reached`);
            paidAttempts++;
            const { message, authorization } = buildEscrowRequest(offer, WALLET, crypto.randomUUID(), Math.floor(Date.now() / 1000));
            const signature = await account.signMessage({ message });
            escrowSent = authorization;
            const r = await fetch(url, {
              method: "POST", signal: AbortSignal.timeout(60000),
              headers: { "Content-Type": "application/json", "X-PAYMENT": encodeEscrowPayment(ESCROW_PIN.network, signature, authorization) },
              body: reqBody,
            });
            if (r.status === 402) { // refused: the node does not bill a failed request, so the next rail may be tried
              const t = await r.clone().text();
              let reason = "no reason given"; try { reason = String(JSON.parse(t).reason ?? reason).slice(0, 240); } catch { /* keep default */ }
              escrowRefusal = `escrow refused by the node: ${reason}`;
              if (!rails.exact) { rail = "escrow"; viaEscrow = r; } else escrowSent = null; // nothing was billed
            } else { rail = "escrow"; viaEscrow = r; }
          }
        }
      }
    }
    if (viaEscrow) res = viaEscrow;
    else res = await fetchWithPayment(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody });
  } catch (e0) {
    const e = loudRefusal(e0) ?? e0;
    // If a payment was already signed and sent, record it so a re-run never pays twice.
    if (currentCallPaid || escrowSent) {
      writeFileSync(`${RECEIPTS}/${stamp()}-${c.label}.json`, JSON.stringify({
        label: c.label, miner_id_requested: c.minerId ?? null, intent: c.intent, params: c.params ?? null, query: c.query ?? null,
        idempotency_key: keyOf(c), paid: true, http_status: null, error: String(e),
        rail: escrowSent ? "escrow" : "exact", ...(escrowSent ? { escrow_request: escrowSent } : {}),
        payment: escrowSent ? escrowPayment() : selectedPayment(),
      }, null, 2));
    }
    throw e;
  }
  const text = await res.text();
  // Escrow: a 2xx answer is a served (billed) call. Its receipt comes in X-PAYMENT-RESPONSE; a missing or mismatching one is recorded, never invented.
  const served = rail === "escrow" && res.status >= 200 && res.status < 300 && !!escrowSent;
  const escrowReceipt: EscrowReceipt | null = rail === "escrow" ? decodeEscrowReceipt(res.headers.get("x-payment-response")) : null;
  const receiptOk = served && escrowSent ? escrowReceiptMatches(escrowReceipt, WALLET, BigInt(escrowSent.value)) : false;
  let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  const file = `${stamp()}-${c.label}.json`;
  // Unpaid refusals (400/402/404/503 before settlement) carry no receipt; keep them out of the ledger.
  const record = {
    label: c.label, miner_id_requested: c.minerId ?? null, intent: c.intent, params: c.params ?? null, query: c.query ?? null,
    idempotency_key: keyOf(c), paid: rail === "escrow" ? served : currentCallPaid, http_status: res.status, rail,
    // The asset this call was allowed to pay with. Receipts written before 2026-11-17 have no such field (the previous asset).
    payment: rail === "escrow" ? escrowPayment() : selectedPayment(),
    ...(rail === "escrow" ? { escrow_request: escrowSent, escrow_available_before_uusdc: escrowAvailableBefore, escrow_receipt: escrowReceipt, escrow_receipt_matches: receiptOk } : {}),
    ...(escrowRefusal ? { escrow_refusal: escrowRefusal } : {}),
    payment_response: b64json(res.headers.get("payment-response")),
    telegraph_receipt: b64json(res.headers.get("x-telegraph-receipt")),
    response: body,
  };
  writeFileSync(`${RECEIPTS}/${file}`, JSON.stringify(record, null, 2));
  const paidNow = rail === "escrow" ? served : currentCallPaid;
  console.log(`[${c.label}] HTTP ${res.status} paid=${paidNow} rail=${rail} -> data/receipts/${file}`);
  return { status: res.status, paid: paidNow, body, file, receipt_file: file };
}

export function readReceipt(file: string): any {
  return JSON.parse(readFileSync(`${RECEIPTS}/${file}`, "utf8"));
}
