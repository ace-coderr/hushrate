// The duplicate-request key must not make a constant-params purchase (BTC price) a one-time event. Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { keyOf } from "./dedupe.js";

const btc = (hour?: string) => keyOf({ minerId: "7320", intent: "CRYPTO_PRICE_USD", params: { symbol: "BTC" }, dedupe: hour });

test("REGRESSION: a BTC purchase in a later hour is not a duplicate of an earlier hour's", () => {
  assert.notEqual(btc("2026-11-12T22-00-00Z"), btc("2026-11-12T23-00-00Z"));
});

test("the same BTC request in the same hour is a duplicate", () => {
  assert.equal(btc("2026-11-12T22-00-00Z"), btc("2026-11-12T22-00-00Z"));
});

test("without dedupe a constant-params request would collide forever (the bug this guards against)", () => {
  assert.equal(btc(undefined), btc(undefined));
  assert.notEqual(btc(undefined), btc("2026-11-12T22-00-00Z"), "a probe receipt (no dedupe) never matches an hourly purchase");
});

test("requests with changing params keep the original key format, so old receipts still match", () => {
  assert.equal(keyOf({ minerId: "71083", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: 975593 } }),
    JSON.stringify(["71083", "MINING_HASHPRICE_VERIFY_GENERAL", { block_height: 975593 }]));
  assert.notEqual(
    keyOf({ minerId: "71083", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: 1 } }),
    keyOf({ minerId: "71083", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: 2 } }));
});
