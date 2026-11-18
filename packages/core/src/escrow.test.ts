// The escrow rail's rules, on the challenge shape the node sends (copied from data/probe/escrow-*.json). Run: npm test -w packages/core
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkEscrowOffer, buildEscrowRequest, encodeEscrowPayment, decodeEscrowReceipt, escrowReceiptMatches, escrowAmountOf, priceToUnits, escrowFunding, chooseRail, classifyBilling,
  ESCROW_MAX_WINDOW_SECONDS, ESCROW_WINDOW_SECONDS, type EscrowOption, type EscrowPin,
} from "./index.js";

const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const PIN: EscrowPin = { network: "eip155:11155111", diamond: DIAMOND };
const CAP = 30000n;
const WALLET = "0x3F857679462C80CC4Ffe99635aA3bd6e44FC913e";
const template = (over: { payTo?: string; network?: string; amount?: string; resource?: string } = {}) =>
  `Telegraph Escrow Payment\n\nWallet: {from}\nPay To: ${over.payTo ?? DIAMOND.toLowerCase()}\nNetwork: ${over.network ?? "eip155:11155111"}\nAmount: ${over.amount ?? "10000"} uUSDC\nResource: ${over.resource ?? "/v1/ask/7320"}\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}`;
const offer = (over: Partial<EscrowOption> & { msg?: Parameters<typeof template>[0] } = {}): EscrowOption => ({
  scheme: "escrow", network: "eip155:11155111", payTo: DIAMOND.toLowerCase(), amount: "10000",
  extra: { description: "Charged to the caller's Telegraph escrow balance", message: template(over.msg), resource: "/v1/ask/7320", signWith: "personal_sign (EIP-191)" }, ...over,
});
const exact: EscrowOption = { scheme: "exact", network: "eip155:11155111", payTo: DIAMOND, amount: "10000" };

test("the message template is filled exactly as given: lower-case wallet, nonce, window", () => {
  const o = checkEscrowOffer([exact, offer()], PIN, CAP, "/v1/ask/7320");
  assert.equal(o.state, "ok");
  if (o.state !== "ok") return;
  const { message, authorization } = buildEscrowRequest(o, WALLET, "n-1", 1_800_000_000);
  assert.ok(message.includes(`Wallet: ${WALLET.toLowerCase()}\n`), "the wallet is lower-cased");
  assert.ok(!message.includes("{"), "every placeholder is filled");
  assert.ok(message.startsWith("Telegraph Escrow Payment\n\nWallet:"));
  assert.ok(message.includes("Nonce: n-1\n"));
  assert.ok(message.includes(`Valid After: ${authorization.validAfter}\nValid Before: ${authorization.validBefore}`));
  assert.equal(authorization.value, "10000");
  assert.equal(authorization.to, DIAMOND.toLowerCase());
});

test("the validity window is under 2 minutes (90 seconds) and starts slightly in the past", () => {
  const o = checkEscrowOffer([offer()], PIN, CAP, "/v1/ask/7320");
  assert.equal(o.state, "ok");
  if (o.state !== "ok") return;
  const { authorization: a } = buildEscrowRequest(o, WALLET, "x", 1_800_000_000);
  const span = Number(a.validBefore) - Number(a.validAfter);
  assert.equal(span, ESCROW_WINDOW_SECONDS);
  assert.ok(span < ESCROW_MAX_WINDOW_SECONDS);
  assert.ok(Number(a.validAfter) < 1_800_000_000 && Number(a.validBefore) > 1_800_000_000, "the window contains now");
});

test("the X-PAYMENT header is base64 JSON with the escrow envelope", () => {
  const o = checkEscrowOffer([offer()], PIN, CAP, "/v1/ask/7320");
  if (o.state !== "ok") throw new Error("offer should be ok");
  const { authorization } = buildEscrowRequest(o, WALLET, "n-2", 1_800_000_000);
  const header = encodeEscrowPayment("eip155:11155111", "0xsig", authorization);
  const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  assert.equal(j.x402Version, 2);
  assert.equal(j.scheme, "escrow");
  assert.equal(j.network, "eip155:11155111");
  assert.equal(j.payload.signature, "0xsig");
  assert.deepEqual(Object.keys(j.payload.authorization).sort(), ["from", "nonce", "to", "validAfter", "validBefore", "value"]);
});

test("a template amount that differs from the 402 amount is refused", () => {
  const o = checkEscrowOffer([offer({ msg: { amount: "20000" } })], PIN, CAP, "/v1/ask/7320");
  assert.equal(o.state, "refused");
  if (o.state === "refused") assert.match(o.reason, /differs from the quoted/);
});

test("the quote may carry a price instead of an amount, and must still agree with the template", () => {
  const { amount: _a, ...noAmount } = offer();
  assert.equal(checkEscrowOffer([{ ...noAmount, price: "$0.01" }], PIN, CAP, "/v1/ask/7320").state, "ok");
  assert.equal(checkEscrowOffer([{ ...noAmount, price: "$0.02" }], PIN, CAP, "/v1/ask/7320").state, "refused");
  assert.equal(priceToUnits("$0.01"), 10000n);
  assert.equal(priceToUnits("1"), null);
});

test("an amount above the 3-cent per-payment cap is refused", () => {
  const o = checkEscrowOffer([offer({ amount: "40000", msg: { amount: "40000" } })], PIN, CAP, "/v1/ask/7320");
  assert.equal(o.state, "refused");
  if (o.state === "refused") assert.match(o.reason, /above the per-payment cap/);
});

test("a wrong payTo is refused, in the challenge and in the message", () => {
  const other = "0x1111111111111111111111111111111111111111";
  const a = checkEscrowOffer([offer({ payTo: other })], PIN, CAP, "/v1/ask/7320");
  assert.equal(a.state, "refused");
  if (a.state === "refused") assert.match(a.reason, /not the pinned Diamond/);
  const b = checkEscrowOffer([offer({ msg: { payTo: other } })], PIN, CAP, "/v1/ask/7320");
  assert.equal(b.state, "refused");
  if (b.state === "refused") assert.match(b.reason, /does not name the pinned Diamond/);
});

test("another network, in the challenge or the message, is refused", () => {
  assert.equal(checkEscrowOffer([offer({ network: "eip155:1" })], PIN, CAP, "/v1/ask/7320").state, "refused");
  assert.equal(checkEscrowOffer([offer({ msg: { network: "eip155:1" } })], PIN, CAP, "/v1/ask/7320").state, "refused");
});

test("a template for a different resource, or with a missing placeholder, is refused", () => {
  assert.equal(checkEscrowOffer([offer({ msg: { resource: "/v1/ask/999" } })], PIN, CAP, "/v1/ask/7320").state, "refused");
  const o = offer();
  o.extra!.message = o.extra!.message!.replace("{nonce}", "fixed");
  assert.equal(checkEscrowOffer([o], PIN, CAP, "/v1/ask/7320").state, "refused");
});

test("no escrow entry means the rail is absent, not refused", () => {
  assert.equal(checkEscrowOffer([exact], PIN, CAP).state, "absent");
  assert.equal(checkEscrowOffer(null, PIN, CAP).state, "absent");
});

test("the Amount line is read from the template", () => {
  assert.equal(escrowAmountOf(template()), 10000n);
  assert.equal(escrowAmountOf("no amount here"), null);
});

test("insufficient escrow is reported as unfunded, and an unreadable balance as unknown", () => {
  assert.equal(escrowFunding("8000000", 20000n).state, "ok");
  const low = escrowFunding("5000", 20000n);
  assert.equal(low.state, "unfunded");
  if (low.state === "unfunded") assert.deepEqual([low.available, low.needed], [5000n, 20000n]);
  assert.equal(escrowFunding(null, 20000n).state, "unknown");
  assert.equal(escrowFunding("not a number", 20000n).state, "unknown");
});

test("fallback order: escrow, then exact, then public; an unknown escrow balance never falls back to settlement", () => {
  const ok = checkEscrowOffer([offer()], PIN, CAP, "/v1/ask/7320");
  const exactOk = { ok: true, reason: "" }, exactNo = { ok: false, reason: "the wallet is unfunded for the asked-for token" };
  assert.equal(chooseRail(ok, escrowFunding("8000000", 20000n), exactOk).rail, "escrow", "funded escrow wins even when exact is possible");
  assert.equal(chooseRail(ok, escrowFunding("0", 20000n), exactOk).rail, "exact", "unfunded escrow falls back to exact");
  assert.equal(chooseRail(ok, escrowFunding("0", 20000n), exactNo).rail, "public", "nothing can pay: labelled public values");
  const unknown = chooseRail(ok, escrowFunding(null, 20000n), exactOk);
  assert.equal(unknown.rail, "public", "balance unknown: do not settle by the exact rail");
  assert.match(unknown.reason, /not falling back to settlement/);
  assert.equal(chooseRail({ state: "absent" }, null, exactOk).rail, "exact", "no escrow offered: exact as before");
  const refused = checkEscrowOffer([offer({ payTo: "0x1111111111111111111111111111111111111111" })], PIN, CAP, "/v1/ask/7320");
  assert.equal(chooseRail(refused, null, exactNo).rail, "public");
  assert.match(chooseRail(refused, null, exactNo).reason, /escrow terms refused/);
});

test("the receipt is decoded from X-PAYMENT-RESPONSE and must match the payment we signed", () => {
  const hash = "0x" + "ab".repeat(32);
  const header = Buffer.from(JSON.stringify({ receipt_hash: hash, rail: "escrow", payer: WALLET.toLowerCase(), miner: "7320", intent: "CRYPTO_PRICE_USD", amount_uusdc: "10000", epoch_id: 314, settlement: "epoch", chain: "telegraph", timestamp: 1789466181 })).toString("base64");
  const r = decodeEscrowReceipt(header);
  assert.equal(r?.epoch_id, 314);
  assert.equal(r?.settlement, "epoch");
  assert.ok(!("tx_hash" in (r ?? {})), "an escrow receipt has no tx_hash");
  assert.equal(escrowReceiptMatches(r, WALLET, 10000n), true);
  assert.equal(escrowReceiptMatches(r, WALLET, 20000n), false, "a different amount does not match");
  assert.equal(escrowReceiptMatches(r, "0x2222222222222222222222222222222222222222", 10000n), false, "a different payer does not match");
  assert.equal(decodeEscrowReceipt(null), null);
  assert.equal(decodeEscrowReceipt("%%%"), null);
});

test("billing: verified only after a 200 that names this wallet; 404 'no block recorded' stays pending", () => {
  const h = "0x" + "cd".repeat(32), now = "2026-11-18T22:00:00Z";
  const args = { receipt_hash: h, epoch_id: 314, wallet: WALLET, now };
  const pending = classifyBilling({ ...args, http_status: 404, body: { error: "no block recorded for this epoch" } });
  assert.deepEqual([pending.billing_verified, pending.status], [null, "pending"]);
  const ok = classifyBilling({ ...args, http_status: 200, body: { delivery: { payer: WALLET.toLowerCase(), usdc: "10000" }, deliveries_root: "0xroot" } });
  assert.deepEqual([ok.billing_verified, ok.status, ok.deliveries_root], [true, "verified", "0xroot"]);
  assert.equal(classifyBilling({ ...args, http_status: 200, body: { delivery: { payer: "0x3333333333333333333333333333333333333333" } } }).billing_verified, false);
  assert.equal(classifyBilling({ ...args, http_status: 404, body: { error: "delivery not found" } }).status, "not_found");
  assert.equal(classifyBilling({ ...args, http_status: null, body: null }).billing_verified, null, "an unreachable node proves nothing");
  assert.equal(classifyBilling({ ...args, http_status: 500, body: null }).billing_verified, null);
  assert.equal(classifyBilling({ ...args, wallet: "", http_status: 200, body: { payer: "anything" } }).billing_verified, false, "never verified without a wallet to match");
});
