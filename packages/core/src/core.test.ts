// Hand-computed checks. Run: npm test -w packages/core
import test from "node:test";
import assert from "node:assert/strict";
import { decide, validateSite, hashrateTh, blockHashprice, windowHashprice, selectPower, type Site, type PowerPrice } from "./index.js";

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
