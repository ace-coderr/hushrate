// Hand-computed check of the economics. Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { decide, type Site } from "./decide.js";

// 10,000 TH/s at 20 J/TH = 200 kW = 4.8 MWh/day.
// Revenue: 10 PH * 40,000 sats = 400,000 sats = 0.004 BTC = $400 at $100,000/BTC.
const site: Site = { name: "t", caiso_node: "n", hashrate_th: 10000, efficiency_j_per_th: 20, power_adder_usd_per_mwh: 10, min_margin_usd_per_day: 0 };
const base = { hashprice_sats_per_ph_day: 40000, btc_usd: 100000 };

test("runs when margin is positive", () => {
  const d = decide(site, { ...base, lmp_usd_per_mwh: 30 });
  assert.equal(d.action, "RUN");
  assert.ok(Math.abs(d.revenue_usd_per_day - 400) < 1e-9);
  assert.ok(Math.abs(d.power_cost_usd_per_day - 192) < 1e-9);
  assert.ok(Math.abs(d.margin_usd_per_day - 208) < 1e-9);
  assert.ok(Math.abs(d.breakeven_lmp_usd_per_mwh - (400 / 4.8 - 10)) < 1e-9);
});

test("curtails when power costs more than revenue", () => {
  assert.equal(decide(site, { ...base, lmp_usd_per_mwh: 100 }).action, "CURTAIL");
});

test("curtails exactly at breakeven (margin must exceed the threshold)", () => {
  const d = decide(site, { ...base, lmp_usd_per_mwh: 400 / 4.8 - 10 });
  assert.equal(d.action, "CURTAIL");
});

test("negative LMP runs", () => {
  assert.equal(decide(site, { ...base, lmp_usd_per_mwh: -20 }).action, "RUN");
});
