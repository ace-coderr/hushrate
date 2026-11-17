// The ledger must keep old receipts readable (no asset recorded = the previous asset) and carry the asset on new ones.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_PAYMENT_ASSET } from "@hushrate/core";
import { buildLedger } from "./ledger.js";

const NEW_ASSET = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const base = { intent: "MINING_HASHPRICE_VERIFY_GENERAL", miner_id_requested: "71083", params: { block_height: 1 }, paid: true, http_status: 200, response: { miner_id: "71083", cost_usd: 0.01 } };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hushrate-ledger-")) + "/";
  mkdirSync(`${root}data/receipts`, { recursive: true });
  const put = (name: string, o: object) => writeFileSync(`${root}data/receipts/${name}`, JSON.stringify(o));
  // Written before 2026-11-17: no payment field at all.
  put("2026-11-16T06-17-30-000Z-hashprice-1.json", { ...base, label: "hashprice-1", telegraph_receipt: { receipt_hash: "0xa", tx_hash: "0x1", payer: "0xp", chain: "eip155:11155111" } });
  // Written after: records the pinned asset it was allowed to pay with.
  put("2026-11-17T15-17-30-000Z-hashprice-2.json", { ...base, label: "hashprice-2", payment: { asset: NEW_ASSET, network: "eip155:11155111", pay_to: "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b" }, telegraph_receipt: { receipt_hash: "0xb", tx_hash: "0x2", payer: "0xp" } });
  // A refused payment (HTTP 402): nothing settled, so it is not a ledger row.
  put("2026-11-17T15-18-00-000Z-hashprice-3.json", { ...base, label: "hashprice-3", http_status: 402, response: {} });
  // Never paid (refused before payment): not a ledger row either.
  put("2026-11-17T15-19-00-000Z-hashprice-4.json", { ...base, label: "hashprice-4", paid: false, http_status: 503, response: {} });
  return root;
}

test("a receipt without a recorded asset is the previous asset; a new one carries the pinned asset", () => {
  const rows = buildLedger(fixture());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].asset, LEGACY_PAYMENT_ASSET);
  assert.equal(rows[1].asset, NEW_ASSET);
  assert.equal(rows[1].network, "eip155:11155111");
});

test("refused (402) and unpaid receipts are not ledger rows", () => {
  const labels = buildLedger(fixture()).map((r) => r.label);
  assert.deepEqual(labels, ["hashprice-1", "hashprice-2"]);
});
