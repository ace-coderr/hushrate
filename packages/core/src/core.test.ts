// Hand-computed checks. Run: npm test -w packages/core
import test from "node:test";
import assert from "node:assert/strict";
import { decide, validateSite, hashrateTh, blockHashprice, windowHashprice, selectPower, checkBtcPurchase, checkHashpricePurchase, mayTryFallback, toHistoryEntry, type Site, type PowerPrice, type MarketTape } from "./index.js";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// 10 MW at 20 J/TH: 10e6 W / 20 = 500,000 TH/s = 500 PH/s; energy 240 MWh/day.
// Revenue at 40,000 sats/PH/day and $100,000/BTC: 500 PH * 40,000 sats = 2e7 sats = 0.2 BTC = $20,000.
const site: Site = { name: "t", node: "n", power_mw: 10, efficiency_j_per_th: 20, power_adder_usd_per_mwh: 10, min_margin_usd_per_day: 0 };
const mkt = { hashprice_sats_per_ph_day: 40000, btc_usd: 100000 };

test("hashrate from load and efficiency", () => near(hashrateTh(site), 500000));

test("RUN with hand-computed margin and breakeven", () => {
  const d = decide(site, { ...mkt, power_usd_per_mwh: 30 });
  assert.equal(d.action, "RUN");
  near(d.revenue_usd_per_day!, 20000);
  near(d.power_cost_usd_per_day!, 240 * 40);      // 9,600
  near(d.margin_usd_per_day!, 10400);
  near(d.breakeven_power_usd_per_mwh!, 20000 / 240 - 10); // 73.3333
  assert.equal(d.loss_avoided_usd_per_day, 0);
});

test("CURTAIL when power costs more than revenue, with loss avoided", () => {
  const d = decide(site, { ...mkt, power_usd_per_mwh: 100 });
  assert.equal(d.action, "CURTAIL");
  near(d.margin_usd_per_day!, 20000 - 240 * 110); // -6,400
  near(d.loss_avoided_usd_per_day!, 6400);
});

test("exactly at breakeven curtails (margin must be strictly above threshold)", () => {
  assert.equal(decide(site, { ...mkt, power_usd_per_mwh: 20000 / 240 - 10 }).action, "CURTAIL");
});

test("minimum margin threshold shifts the breakeven", () => {
  const s = { ...site, min_margin_usd_per_day: 2400 };
  near(decide(s, { ...mkt, power_usd_per_mwh: 30 }).breakeven_power_usd_per_mwh!, (20000 - 2400) / 240 - 10);
});

test("negative power price runs", () => assert.equal(decide(site, { ...mkt, power_usd_per_mwh: -20 }).action, "RUN"));

test("HOLD whenever an input is missing, never a guess", () => {
  for (const m of [
    { ...mkt, power_usd_per_mwh: null },
    { ...mkt },
    { power_usd_per_mwh: 30, btc_usd: 100000 },
    { power_usd_per_mwh: 30, hashprice_sats_per_ph_day: 40000 },
    { ...mkt, power_usd_per_mwh: NaN },
    { ...mkt, power_usd_per_mwh: 30, btc_usd: 0 },
  ]) {
    const d = decide(site, m);
    assert.equal(d.action, "HOLD");
    assert.ok(d.reasons.length > 0);
    assert.equal(d.margin_usd_per_day, undefined);
  }
});

test("HOLD for an invalid site", () => {
  assert.equal(decide({ ...site, power_mw: 0 }, { ...mkt, power_usd_per_mwh: 30 }).action, "HOLD");
  assert.deepEqual(validateSite(site), []);
  assert.ok(validateSite({ name: "", node: "" }).length >= 4);
});

test("block hashprice matches hand calculation", () => {
  // reward 3.125e8 sats, difficulty 1e14: 3.125e8 * 8.64e19 / (1e14 * 4294967296) = 62,865.0...
  const v = blockHashprice(3.125e8, 1e14);
  assert.ok(Math.abs(v - (3.125e8 * 8.64e19) / (1e14 * 4294967296)) < 1e-6);
  assert.ok(v > 62864 && v < 62866);
});

test("window hashprice is the mean of block values and reports the range", () => {
  const rows = [
    { height: 3, difficulty: 1e14, reward_sats: 3.125e8, timestamp: 0 },
    { height: 2, difficulty: 1e14, reward_sats: 6.25e8, timestamp: 0 },
  ];
  const w = windowHashprice(rows);
  near(w.hashprice_sats_per_ph_day, (blockHashprice(3.125e8, 1e14) + blockHashprice(6.25e8, 1e14)) / 2, 1e-6);
  assert.equal(w.from_height, 2); assert.equal(w.to_height, 3); assert.equal(w.blocks, 2);
  assert.throws(() => windowHashprice([]));
  assert.throws(() => windowHashprice([{ height: 1, difficulty: 0, reward_sats: 1, timestamp: 0 }]));
});

test("power selection: real-time first, then verified Telegraph day-ahead, then CAISO day-ahead", () => {
  const base: PowerPrice = { node: "n", day_ahead_usd_per_mwh: 30, day_ahead_interval: "x", real_time_usd_per_mwh: null, real_time_interval: null, telegraph: null, errors: [] };
  assert.deepEqual(selectPower({ ...base, real_time_usd_per_mwh: 55 }).basis, "real-time");
  assert.equal(selectPower({ ...base, real_time_usd_per_mwh: 55 }).usd_per_mwh, 55);
  const tg = { intent: "i", requested_miner: "1", http_status: 200, paid: true, cost_usd: 0.01, value: 31, accepted: true };
  assert.equal(selectPower({ ...base, telegraph: tg }).usd_per_mwh, 31);
  assert.equal(selectPower({ ...base, telegraph: { ...tg, accepted: false } }).usd_per_mwh, 30);
  assert.equal(selectPower({ ...base, day_ahead_usd_per_mwh: null }).usd_per_mwh, null);
});

const ok = { http_status: 200, field_status: { price_usd: "ok" }, value: 71407.4 };

test("BTC purchase: accepted only inside 0.5% of the public price with an ok field", () => {
  // 71,440 * 0.005 = 357.2, so 71,407.4 (32.6 away) passes and a 358 gap fails.
  assert.equal(checkBtcPurchase(ok, 71440, 0.005).accepted, true);
  assert.equal(checkBtcPurchase({ ...ok, value: 71440 + 357 }, 71440, 0.005).accepted, true);
  const far = checkBtcPurchase({ ...ok, value: 71440 + 358 }, 71440, 0.005);
  assert.equal(far.accepted, false);
  assert.match(far.reason!, /differs 0.50% .*limit 0.5%/);
});

test("BTC purchase: every failure falls back to the public price with a reason", () => {
  assert.match(checkBtcPurchase({ ...ok, http_status: 500 }, 71440, 0.005).reason!, /HTTP 500/);
  assert.match(checkBtcPurchase({ ...ok, field_status: { price_usd: "missing" } }, 71440, 0.005).reason!, /field not ok/);
  assert.match(checkBtcPurchase({ ...ok, field_status: null }, 71440, 0.005).reason!, /absent/);
  assert.match(checkBtcPurchase({ ...ok, value: null }, 71440, 0.005).reason!, /no value/);
  assert.match(checkBtcPurchase(ok, null, 0.005).reason!, /no public BTC/);
  assert.match(checkBtcPurchase({ ...ok, reject_reason: "call failed: timeout" }, 71440, 0.005).reason!, /call failed/);
});

test("history entry records which purchases settled, and old tapes without btc stay readable", () => {
  const call = (paid: boolean) => ({ intent: "i", requested_miner: "1", http_status: 200, paid, cost_usd: 0.01, value: 1, accepted: true, receipt_hash: "0xr", tx_hash: "0xt" });
  const base = { schema: 1, interval_start: "2026-01-01T00:00:00Z", recorded_at: "x", block_height: 1, btc_usd: 100000, power: [], spend: { paid_calls: 2, cost_usd: 0.02 }, wallet_usdc_after: null, notes: [] };
  const both = toHistoryEntry({ ...base, hashprice: { value_sats_per_ph_day: 1, source: "telegraph", label: "", public_144: null, telegraph: call(true), public_at_telegraph_height: null }, btc: { value_usd: 1, source: "telegraph", label: "", public_usd: 1, telegraph: call(true) } } as unknown as MarketTape);
  assert.deepEqual(both.paid_kinds, ["hashprice", "btc"]);
  assert.equal(both.tx_hashes.length, 2);
  // An old tape has no btc block: public-only price, one paid kind.
  const old = toHistoryEntry({ ...base, hashprice: { value_sats_per_ph_day: 1, source: "telegraph", label: "", public_144: null, telegraph: call(true), public_at_telegraph_height: null } } as unknown as MarketTape);
  assert.deepEqual(old.paid_kinds, ["hashprice"]);
  assert.equal(old.btc_source, "public");
});

// ---- hashprice acceptance: Telegraph value against the public single-block value at the returned height -----------
const FIELDS_OK = { hashprice_sats_per_ph_day: "ok", block_height: "ok", hashrate_eh_s: "ok", hashprice_usd_per_ph_day: "missing" };
const hp = (over: Record<string, unknown> = {}) => ({ http_status: 200, field_status: FIELDS_OK, value: 46660.8, returned_height: 975758, ...over }) as Parameters<typeof checkHashpricePurchase>[0];

test("hashprice: the recorded 2026-11-14 07:17 purchase is accepted against its matching single-block value", () => {
  // Telegraph 46,660.8 and the public single-block value at block 975758 (recomputed from reward and difficulty) are equal.
  const r = checkHashpricePurchase(hp(), 975758, 46660.8, 0.01);
  assert.equal(r.accepted, true);
  assert.equal(r.reason, null);
});

test("hashprice: the same value is REJECTED when compared with the wrong quantity (the 144-block mean spanning a difficulty step)", () => {
  // 46,660.8 against the 43,251.1 mean recorded that hour is 7.88% apart: the old comparison, kept here to show why it failed.
  const r = checkHashpricePurchase(hp(), 975758, 43251.1, 0.01);
  assert.equal(r.accepted, false);
  assert.match(r.reason!, /differs 7\.88%/);
});

test("hashprice: the 1% limit is exact and is not widened", () => {
  assert.equal(checkHashpricePurchase(hp({ value: 10100 }), 975758, 10000, 0.01).accepted, true, "exactly 1% passes");
  assert.equal(checkHashpricePurchase(hp({ value: 10101 }), 975758, 10000, 0.01).accepted, false, "1.01% fails");
  assert.equal(checkHashpricePurchase(hp({ value: 9899 }), 975758, 10000, 0.01).accepted, false, "also below");
});

test("hashprice: stale height is rejected even when the value matches", () => {
  const r = checkHashpricePurchase(hp({ returned_height: 975757 }), 975758, 46660.8, 0.01);
  assert.equal(r.accepted, false);
  assert.match(r.reason!, /stale height.*975757.*975758/);
});

test("hashprice: a field that is not ok, an HTTP error and a missing value are rejected with a reason", () => {
  assert.match(checkHashpricePurchase(hp({ field_status: { ...FIELDS_OK, hashrate_eh_s: "missing" } }), 975758, 46660.8, 0.01).reason!, /field not ok: hashrate_eh_s/);
  assert.match(checkHashpricePurchase(hp({ http_status: 500 }), 975758, 46660.8, 0.01).reason!, /HTTP 500/);
  assert.match(checkHashpricePurchase(hp({ value: null }), 975758, 46660.8, 0.01).reason!, /no value/);
  assert.match(checkHashpricePurchase(hp(), 975758, null, 0.01).reason!, /no public value/);
  assert.match(checkHashpricePurchase(hp({ reject_reason: "call failed: timeout" }), 975758, 46660.8, 0.01).reason!, /call failed/);
});

test("hashprice: the missing USD field is not required", () => {
  assert.equal(checkHashpricePurchase(hp(), 975758, 46660.8, 0.01).accepted, true); // hashprice_usd_per_ph_day is "missing" in FIELDS_OK
});

test("pinning: the fallback miner may be tried only when the primary signed no payment (miner removed, refused before payment)", () => {
  // Miner removed or refused before payment: HTTP 404/503/400, paid false.
  assert.equal(mayTryFallback({ paid: false }), true);
  const removed = checkHashpricePurchase({ http_status: 404, value: null, returned_height: null, field_status: null }, 975758, 46660.8, 0.01);
  assert.equal(removed.accepted, false);
  assert.match(removed.reason!, /HTTP 404/);
  // A payment was signed (even if the response was lost or the request failed after payment): never pay again this hour.
  assert.equal(mayTryFallback({ paid: true }), false);
});
