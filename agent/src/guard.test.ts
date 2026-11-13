// Same-hour guard, per hour and per intent. Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allBought, hourPrefix, purchasesThisHour, purchasesThisHourFromDisk, type ReceiptFile } from "./guard.js";

const H = "2026-11-12T20:00:00Z";
const HL = H.replace(/:/g, "-"); // labels and file names must not contain colons
const hashReceipt = (t: string, block: number, over: Partial<ReceiptFile> = {}): ReceiptFile =>
  ({ name: `2026-11-12T${t}-hashprice-${block}.json`, paid: true, label: `hashprice-${block}`, intent: "MINING_HASHPRICE_VERIFY_GENERAL", http_status: 200, ...over });
const btcReceipt = (t: string, over: Partial<ReceiptFile> = {}): ReceiptFile =>
  ({ name: `2026-11-12T${t}-btc-${HL}.json`, paid: true, label: `btc-${HL}`, intent: "CRYPTO_PRICE_USD", http_status: 200, ...over });

test("hour prefix matches the receipt file naming", () => assert.equal(hourPrefix(H), "2026-11-12T20-"));

test("NONE paid: both purchases are still to do", () => {
  const p = purchasesThisHour(H, [], []);
  assert.deepEqual([p.hashprice, p.btc, allBought(p)], [false, false, false]);
});

test("ONE paid (hashprice only): only the BTC purchase is missing", () => {
  const p = purchasesThisHour(H, [], [hashReceipt("20-17-04-100Z", 975593)]);
  assert.deepEqual([p.hashprice, p.btc, allBought(p)], [true, false, false]);
});

test("ONE paid (BTC only): only the hashprice purchase is missing", () => {
  const p = purchasesThisHour(H, [], [btcReceipt("20-17-05-000Z")]);
  assert.deepEqual([p.hashprice, p.btc, allBought(p)], [false, true, false]);
});

test("BOTH paid: the hour is a no-op", () => {
  const p = purchasesThisHour(H, [], [hashReceipt("20-17-04-100Z", 975593), btcReceipt("20-17-09-000Z")]);
  assert.equal(allBought(p), true);
});

test("history paid_kinds is honoured, and old entries (no paid_kinds) count as hashprice only", () => {
  const withKinds = purchasesThisHour(H, [{ interval_start: H, paid_calls: 2, paid_kinds: ["hashprice", "btc"] }], []);
  assert.equal(allBought(withKinds), true);
  const old = purchasesThisHour(H, [{ interval_start: H, paid_calls: 1 }], []);
  assert.deepEqual([old.hashprice, old.btc], [true, false]);
  const unpaid = purchasesThisHour(H, [{ interval_start: H, paid_calls: 0 }], []);
  assert.deepEqual([unpaid.hashprice, unpaid.btc], [false, false]);
});

test("other hours, unpaid attempts, refused (402) payments and non-agent labels never count", () => {
  assert.equal(purchasesThisHour(H, [{ interval_start: "2026-11-12T19:00:00Z", paid_calls: 1, paid_kinds: ["hashprice", "btc"] }], []).hashprice, false);
  assert.equal(purchasesThisHour(H, [], [hashReceipt("20-10-00-000Z", 1, { paid: false })]).hashprice, false);
  assert.equal(purchasesThisHour(H, [], [hashReceipt("20-10-00-000Z", 1, { http_status: 402 })]).hashprice, false);
  assert.equal(purchasesThisHour(H, [], [btcReceipt("20-10-00-000Z", { label: "probe-btc-7320" })]).btc, false);
  assert.equal(purchasesThisHour(H, [], [{ name: "2026-11-12T19-59-59-999Z-hashprice-1.json", paid: true, label: "hashprice-1", intent: "MINING_HASHPRICE_VERIFY_GENERAL" }]).hashprice, false);
});

test("a hashprice receipt cannot satisfy the BTC purchase and vice versa (intent-aware)", () => {
  const p = purchasesThisHour(H, [], [hashReceipt("20-17-04-100Z", 1, { label: "btc-wrong-label" })]);
  assert.deepEqual([p.hashprice, p.btc], [false, false]);
});

test("two triggers in one hour at different block heights: the second may buy only what is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "hushrate-guard-")) + "/";
  mkdirSync(`${root}data/receipts`, { recursive: true });
  const save = (r: ReceiptFile) => writeFileSync(`${root}data/receipts/${r.name}`, JSON.stringify({ paid: r.paid, label: r.label, intent: r.intent, http_status: r.http_status }));

  // Nothing yet: the first trigger (the ticker, 20:17) may buy both.
  let p = purchasesThisHourFromDisk(root, H);
  assert.deepEqual([p.hashprice, p.btc], [false, false]);

  // It bought hashprice at block 975593 and died before the BTC purchase. No history entry was written.
  save(hashReceipt("20-17-04-100Z", 975593));
  // The second trigger (the schedule, 20:19) sees a NEW block 975594: the per-request key would differ, the guard must not.
  p = purchasesThisHourFromDisk(root, H);
  assert.deepEqual([p.hashprice, p.btc], [true, false], "hashprice is blocked, BTC is still to buy");

  // The second trigger buys only the BTC price. A third trigger in the same hour is then a complete no-op.
  save(btcReceipt("20-19-30-000Z"));
  p = purchasesThisHourFromDisk(root, H);
  assert.equal(allBought(p), true);

  // The next hour is unaffected.
  p = purchasesThisHourFromDisk(root, "2026-11-12T21:00:00Z");
  assert.deepEqual([p.hashprice, p.btc], [false, false]);
});

test("missing or corrupt files count as nothing paid, never as an error", () => {
  const root = mkdtempSync(join(tmpdir(), "hushrate-guard-")) + "/";
  assert.equal(allBought(purchasesThisHourFromDisk(root, H)), false);
  mkdirSync(`${root}data/receipts`, { recursive: true });
  writeFileSync(`${root}data/history.json`, "not json");
  writeFileSync(`${root}data/receipts/2026-11-12T20-01-00-000Z-x.json`, "{broken");
  const p = purchasesThisHourFromDisk(root, H);
  assert.deepEqual([p.hashprice, p.btc], [false, false]);
});
