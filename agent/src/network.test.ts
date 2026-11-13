// The network loader: Sepolia runs, anything else refuses unless fully and explicitly configured. Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAINNET_ACK_ENV, MAINNET_ACK_VALUE, resolveNetwork, type NetworkConfig } from "./network.js";

const repoConfig = JSON.parse(readFileSync(new URL("../../config/networks.json", import.meta.url), "utf8"));

test("the committed config runs Sepolia", () => {
  const n = resolveNetwork(repoConfig, {});
  assert.equal(n.name, "sepolia");
  assert.equal(n.testnet, true);
  assert.equal(n.caip2, "eip155:11155111");
  assert.equal(n.max_amount_per_payment, "30000");
  assert.equal(n.max_paid_calls_per_run, 3);
});

test("the committed mainnet entry is disabled, empty and refuses to run", () => {
  const m = repoConfig.networks.mainnet as NetworkConfig;
  assert.equal(m.enabled, false);
  for (const k of ["caip2", "chain_id", "rpc_url", "telegraph_node", "expected_wallet", "explorer_tx", "max_amount_per_payment", "max_paid_calls_per_run", "min_balance_units"] as const) assert.equal(m[k], null, `${k} must stay null`);
  assert.equal(m.usdc.address, null);
  assert.throws(() => resolveNetwork({ ...repoConfig, active: "mainnet" }, { [MAINNET_ACK_ENV]: MAINNET_ACK_VALUE }), /disabled/);
});

// Obviously fake test values, used only to exercise the validation rules. They are not Telegraph or mainnet addresses.
const fake = (over: Partial<NetworkConfig> = {}): NetworkConfig => ({
  label: "fixture", testnet: false, enabled: true, caip2: "eip155:1", chain_id: 1, rpc_url: "https://rpc.invalid",
  usdc: { address: "0x" + "11".repeat(20), decimals: 6 }, telegraph_node: "https://node.invalid", expected_wallet: "0x" + "22".repeat(20),
  explorer_tx: "https://explorer.invalid/tx/", max_amount_per_payment: "30000", max_paid_calls_per_run: 3, min_balance_units: "200000", ...over,
});
const cfgWith = (n: NetworkConfig) => ({ active: "x", networks: { x: n } });

test("an enabled non-testnet still refuses without the explicit acknowledgement", () => {
  assert.throws(() => resolveNetwork(cfgWith(fake()), {}), /not a testnet.*HUSHRATE_MAINNET_ENABLE/);
  assert.throws(() => resolveNetwork(cfgWith(fake()), { [MAINNET_ACK_ENV]: "yes" }), /not a testnet/);
});

test("an enabled non-testnet with every value and the acknowledgement is accepted", () => {
  const n = resolveNetwork(cfgWith(fake()), { [MAINNET_ACK_ENV]: MAINNET_ACK_VALUE });
  assert.equal(n.testnet, false);
});

test("a single missing value refuses, and nothing is defaulted", () => {
  for (const over of [{ rpc_url: null }, { telegraph_node: null }, { expected_wallet: null }, { max_amount_per_payment: null }, { min_balance_units: null }, { usdc: { address: null, decimals: 6 } }] as Partial<NetworkConfig>[]) {
    assert.throws(() => resolveNetwork(cfgWith(fake(over)), { [MAINNET_ACK_ENV]: MAINNET_ACK_VALUE }), /missing/);
  }
});

test("malformed addresses, a mismatched chain id and a zero payment cap refuse", () => {
  const ack = { [MAINNET_ACK_ENV]: MAINNET_ACK_VALUE };
  assert.throws(() => resolveNetwork(cfgWith(fake({ usdc: { address: "0x1234", decimals: 6 } })), ack), /valid address/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ expected_wallet: "not-an-address" })), ack), /valid address/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ caip2: "eip155:5" })), ack), /does not match/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ max_amount_per_payment: "0" })), ack), /positive/);
});

test("an unknown active network refuses", () => {
  assert.throws(() => resolveNetwork({ active: "nope", networks: {} }, {}), /not defined/);
});
