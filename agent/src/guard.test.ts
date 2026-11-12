// Same-hour guard: two triggers in one hour must never make two paid purchases. Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hourPrefix, paidThisHour, paidThisHourFromDisk } from "./guard.js";

const H = "2026-11-12T20:00:00Z";

test("hour prefix matches the receipt file naming", () => assert.equal(hourPrefix(H), "2026-11-12T20-"));

test("a history entry with a paid call blocks a second purchase", () => {
  assert.equal(paidThisHour(H, [{ interval_start: H, paid_calls: 1 }], []).paid, true);
});

test("a history entry with no paid call does not block (a failed or unpaid hour can be retried)", () => {
  assert.equal(paidThisHour(H, [{ interval_start: H, paid_calls: 0 }], []).paid, false);
});

test("another hour's history does not block", () => {
  assert.equal(paidThisHour(H, [{ interval_start: "2026-11-12T19:00:00Z", paid_calls: 1 }], []).paid, false);
});

test("a paid receipt inside the hour blocks even when history has no entry", () => {
  const r = paidThisHour(H, [], [{ name: "2026-11-12T20-39-44-749Z-hashprice-975593.json", paid: true }]);
  assert.equal(r.paid, true);
  assert.match(r.why!, /already paid/);
});

test("an unpaid receipt or one from the previous hour does not block", () => {
  assert.equal(paidThisHour(H, [], [{ name: "2026-11-12T20-10-00-000Z-hashprice-1.json", paid: false }]).paid, false);
  assert.equal(paidThisHour(H, [], [{ name: "2026-11-12T19-59-59-999Z-hashprice-1.json", paid: true }]).paid, false);
});

test("two triggers in one hour at different block heights: the second is blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "hushrate-guard-")) + "/";
  mkdirSync(`${root}data/receipts`, { recursive: true });
  // Trigger 1 (say the ticker) at 20:17 bought for block 975593 and left a paid receipt; history.json is not written yet.
  assert.equal(paidThisHourFromDisk(root, H).paid, false, "nothing paid yet: the first trigger may buy");
  writeFileSync(`${root}data/receipts/2026-11-12T20-17-04-100Z-hashprice-975593.json`, JSON.stringify({ paid: true, http_status: 200 }));
  // Trigger 2 (say the schedule) at 20:19, a new block 975594 has arrived: the per-request key would differ, the hour guard must not.
  const second = paidThisHourFromDisk(root, H);
  assert.equal(second.paid, true);
  // The next hour is unaffected.
  assert.equal(paidThisHourFromDisk(root, "2026-11-12T21:00:00Z").paid, false);
});

test("missing or corrupt files count as nothing paid, never as an error", () => {
  const root = mkdtempSync(join(tmpdir(), "hushrate-guard-")) + "/";
  assert.equal(paidThisHourFromDisk(root, H).paid, false);
  mkdirSync(`${root}data/receipts`, { recursive: true });
  writeFileSync(`${root}data/history.json`, "not json");
  writeFileSync(`${root}data/receipts/2026-11-12T20-01-00-000Z-x.json`, "{broken");
  assert.equal(paidThisHourFromDisk(root, H).paid, false);
});
