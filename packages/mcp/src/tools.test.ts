// Test fixture: a hand-built tape with round numbers so every expected value can be checked by hand.
import test from "node:test";
import assert from "node:assert/strict";
import type { MarketTape } from "@hushrate/core";
import { decideFromTape, receiptsView, summarizeMarket } from "./tools.js";

const tape = {
  schema: 1, interval_start: "2026-01-01T00:00:00Z", recorded_at: "2026-01-01T00:07:00Z", block_height: 1, btc_usd: 100000,
  hashprice: { value_sats_per_ph_day: 40000, source: "public", label: "fixture", public_144: null, telegraph: null, public_at_telegraph_height: null },
  power: [
    { node: "A", day_ahead_usd_per_mwh: 30, day_ahead_interval: "x", real_time_usd_per_mwh: 50, real_time_interval: "x", telegraph: null, errors: [] },
    { node: "B", day_ahead_usd_per_mwh: 30, day_ahead_interval: "x", real_time_usd_per_mwh: null, real_time_interval: null, telegraph: null, errors: [] },
  ],
  spend: { paid_calls: 0, cost_usd: 0 }, wallet_usdc_after: null, notes: [],
} as unknown as MarketTape;

test("decide uses real-time when present and labels it", () => {
  // 10 MW at 20 J/TH = 500 PH/s -> $20,000/day revenue; 240 MWh * (50 + 10) = $14,400 cost.
  const r = decideFromTape(tape, { node: "A", power_mw: 10, efficiency_j_per_th: 20, power_adder_usd_per_mwh: 10 });
  assert.equal(r.decision, "RUN");
  assert.equal(r.inputs.power_basis, "real-time");
  assert.ok(Math.abs(r.margin_usd_per_day! - 5600) < 1e-6);
  assert.ok(Math.abs(r.breakeven_power_usd_per_mwh! - (20000 / 240 - 10)) < 1e-9);
});

test("decide falls back to day-ahead and labels it", () => {
  const r = decideFromTape(tape, { node: "B", power_mw: 10, efficiency_j_per_th: 20, power_adder_usd_per_mwh: 10 });
  assert.equal(r.inputs.power_basis, "day-ahead");
  assert.ok(Math.abs(r.margin_usd_per_day! - (20000 - 240 * 40)) < 1e-6);
});

test("unknown node holds", () => {
  const r = decideFromTape(tape, { node: "Z", power_mw: 10, efficiency_j_per_th: 20 });
  assert.equal(r.decision, "HOLD");
  assert.equal(r.margin_usd_per_day, null);
});

test("market summary labels the basis per node", () => {
  const s = summarizeMarket(tape);
  assert.deepEqual(s.power.map((p) => p.basis), ["real-time", "day-ahead"]);
});

test("receipts are newest first and the limit is clamped", () => {
  const rows = [{ at: "1" }, { at: "2" }, { at: "3" }];
  assert.deepEqual(receiptsView(rows, 2).map((r) => r.at), ["3", "2"]);
  assert.equal(receiptsView(rows, 0).length, 1);
});
