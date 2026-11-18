// Escrow in the agent's records: ledger rows, the same-hour guard under both rails, old receipts, and the billing check.
// Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_PAYMENT_ASSET } from "@hushrate/core";
import { buildLedger } from "./ledger.js";
import { purchasesThisHour, type ReceiptFile } from "./guard.js";
import { checkBilling, receiptsToCheck } from "./billing.js";

const WALLET = "0x3f857679462c80cc4ffe99635aa3bd6e44fc913e";
const HASH = "0x" + "ab".repeat(32);
const TOKEN = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const escrowReceipt = (over: object = {}) => ({
  label: "hashprice-976400", intent: "MINING_HASHPRICE_VERIFY_GENERAL", miner_id_requested: "71083", params: { block_height: 976400 }, paid: true, http_status: 200, rail: "escrow",
  payment: { rail: "escrow", asset: TOKEN, network: "eip155:11155111", pay_to: DIAMOND },
  escrow_receipt: { receipt_hash: HASH, rail: "escrow", payer: WALLET, miner: "71083", amount_uusdc: "10000", epoch_id: 314, settlement: "epoch", chain: "telegraph" },
  response: { miner_id: "71083", cost_usd: 0.01, signal_hash: "0xsig" }, ...over,
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hushrate-escrow-")) + "/";
  mkdirSync(`${root}data/receipts`, { recursive: true });
  const put = (name: string, o: object) => writeFileSync(`${root}data/receipts/${name}`, JSON.stringify(o));
  return { root, put };
}

test("an escrow receipt becomes a ledger row with a receipt hash and epoch, and NO tx hash", () => {
  const { root, put } = fixture();
  put("2026-11-18T21-17-30-000Z-hashprice-976400.json", escrowReceipt());
  const [row] = buildLedger(root);
  assert.equal(row.rail, "escrow");
  assert.equal(row.receipt_hash, HASH);
  assert.equal(row.epoch_id, 314);
  assert.equal(row.tx_hash, null);
  assert.equal(row.payer, WALLET);
  assert.equal(row.asset, TOKEN);
  assert.equal(row.billing_verified, null);
  assert.equal(row.billing_status, "not checked yet");
});

test("old tapes and receipts stay readable: no rail recorded means exact (settled per call), with its tx hash", () => {
  const { root, put } = fixture();
  put("2026-11-16T06-17-30-000Z-hashprice-1.json", { label: "hashprice-1", intent: "MINING_HASHPRICE_VERIFY_GENERAL", paid: true, http_status: 200, response: { miner_id: "71083", cost_usd: 0.01 }, telegraph_receipt: { receipt_hash: "0xa", tx_hash: "0x1", payer: "0xp" } });
  const [row] = buildLedger(root);
  assert.equal(row.rail, "exact");
  assert.equal(row.tx_hash, "0x1");
  assert.equal(row.asset, LEGACY_PAYMENT_ASSET);
  assert.equal(row.epoch_id, null);
  assert.equal(row.billing_verified, null);
});

test("the same-hour guard counts a paid escrow receipt exactly like an exact one, and a failed escrow attempt does not count", () => {
  const H = "2026-11-18T21:00:00Z";
  const rec = (name: string, paid: boolean, status: number): ReceiptFile => ({ name, paid, label: "hashprice-976400", intent: "MINING_HASHPRICE_VERIFY_GENERAL", http_status: status });
  assert.equal(purchasesThisHour(H, [], [rec("2026-11-18T21-17-30-000Z-hashprice-976400.json", true, 200)]).hashprice, true, "a served escrow call blocks a second purchase this hour");
  assert.equal(purchasesThisHour(H, [], [rec("2026-11-18T21-17-30-000Z-hashprice-976400.json", false, 402)]).hashprice, false, "an unbilled escrow refusal may be retried");
  // The tape history is the second source: a recorded paid kind blocks it whatever the rail.
  assert.equal(purchasesThisHour(H, [{ interval_start: H, paid_calls: 1, paid_kinds: ["hashprice"] }], []).hashprice, true);
});

test("billing: a pending epoch is recorded as pending, then verified once the node returns the delivery", async () => {
  const { root, put } = fixture();
  put("2026-11-18T21-17-30-000Z-hashprice-976400.json", escrowReceipt());
  assert.deepEqual(receiptsToCheck(root, {}).map((p) => [p.receipt_hash, p.epoch_id]), [[HASH, 314]]);
  const urls: string[] = [];
  const pending = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ error: "no block recorded for this epoch" }), { status: 404 }); }) as unknown as typeof fetch;
  let all = await checkBilling(root, pending, () => "2026-11-18T21:30:00Z");
  assert.match(urls[0], /\/v1\/blocks\/314\/deliveries\/0xabab/);
  assert.deepEqual([all[0].billing_verified, all[0].status], [null, "pending"]);
  assert.equal(JSON.parse(readFileSync(`${root}data/ledger.json`, "utf8"))[0].billing_verified, null);
  const served = (async () => new Response(JSON.stringify({ delivery: { payer: WALLET, usdc: "10000" }, deliveries_root: "0xroot" }), { status: 200 })) as unknown as typeof fetch;
  all = await checkBilling(root, served, () => "2026-11-18T22:30:00Z");
  assert.deepEqual([all[0].billing_verified, all[0].status, all[0].checked_at], [true, "verified", "2026-11-18T22:30:00Z"]);
  assert.equal(JSON.parse(readFileSync(`${root}data/ledger.json`, "utf8"))[0].billing_verified, true);
  // Verified receipts are not asked about again.
  assert.deepEqual(receiptsToCheck(root, { [HASH]: all[0] }), []);
});

test("billing: an unreachable node is recorded as an error, never as verified", async () => {
  const { root, put } = fixture();
  put("2026-11-18T21-17-30-000Z-hashprice-976400.json", escrowReceipt());
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const all = await checkBilling(root, down, () => "2026-11-18T21:30:00Z");
  assert.deepEqual([all[0].billing_verified, all[0].status], [null, "error"]);
});
