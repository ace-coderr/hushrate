// The network loader: Sepolia runs with an explicit allow-list of two assets, anything else refuses unless fully and
// explicitly configured. Run: npm test -w agent
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAINNET_ACK_ENV, MAINNET_ACK_VALUE, resolveNetwork, type NetworkConfig } from "./network.js";

const repoConfig = JSON.parse(readFileSync(new URL("../../config/networks.json", import.meta.url), "utf8"));

const NEW_ASSET = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const OLD_ASSET = "0xcc194e1a843B658526D0D5C431f670028582Ae17";

test("the committed config runs Sepolia with an allow-list of exactly two assets", () => {
  const n = resolveNetwork(repoConfig, {});
  assert.equal(n.name, "sepolia");
  assert.equal(n.testnet, true);
  assert.equal(n.caip2, "eip155:11155111");
  assert.equal(n.max_amount_per_payment, "30000");
  assert.equal(n.max_paid_calls_per_run, 3);
  assert.equal(n.assets.length, 2);
  assert.deepEqual(n.assets.map((a) => a.address), [NEW_ASSET, OLD_ASSET]);
  assert.ok(n.assets.every((a) => a.decimals === 6 && a.symbol === "USDC"));
});

test("both allowed assets are pinned to the node's current payee, and the pre-2026-11-17 payee is not allowed", () => {
  const n = resolveNetwork(repoConfig, {});
  const by = Object.fromEntries(n.assets.map((a) => [a.address, a.pay_to]));
  assert.equal(by[NEW_ASSET], "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b");
  assert.equal(by[OLD_ASSET], "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b", "the node asked for the previous asset paid to this payee on 2026-11-17");
  assert.ok(!n.assets.some((a) => a.pay_to.toLowerCase() === "0x3624eb012b5e998bb57b6be6c9cfc9c4bc5eb99b"), "the earlier payee is no longer allowed");
});

test("only the previous test USDC is mintable here; Circle's token is funded from the faucet", () => {
  const n = resolveNetwork(repoConfig, {});
  assert.equal(n.assets.find((a) => a.address === NEW_ASSET)!.mintable, false);
  assert.equal(n.assets.find((a) => a.address === OLD_ASSET)!.mintable, true);
});

test("the committed mainnet entry is disabled, empty and refuses to run", () => {
  const m = repoConfig.networks.mainnet as NetworkConfig;
  assert.equal(m.enabled, false);
  for (const k of ["caip2", "chain_id", "rpc_url", "telegraph_node", "expected_wallet", "explorer_tx", "max_amount_per_payment", "max_paid_calls_per_run", "min_balance_units"] as const) assert.equal(m[k], null, `${k} must stay null`);
  assert.deepEqual(m.assets, [], "no mainnet asset is invented");
  assert.throws(() => resolveNetwork({ ...repoConfig, active: "mainnet" }, { [MAINNET_ACK_ENV]: MAINNET_ACK_VALUE }), /disabled/);
});

// Obviously fake test values, used only to exercise the validation rules. They are not Telegraph or mainnet addresses.
const fakeAsset = (over: Record<string, unknown> = {}) => ({ address: "0x" + "11".repeat(20), symbol: "USDC", decimals: 6, pay_to: "0x" + "33".repeat(20), ...over });
const fake = (over: Partial<NetworkConfig> = {}): NetworkConfig => ({
  label: "fixture", testnet: false, enabled: true, caip2: "eip155:1", chain_id: 1, rpc_url: "https://rpc.invalid",
  assets: [fakeAsset()], telegraph_node: "https://node.invalid", expected_wallet: "0x" + "22".repeat(20),
  explorer_tx: "https://explorer.invalid/tx/", max_amount_per_payment: "30000", max_paid_calls_per_run: 3, min_balance_units: "200000", ...over,
});
const cfgWith = (n: NetworkConfig) => ({ active: "x", networks: { x: n } });
const ack = { [MAINNET_ACK_ENV]: MAINNET_ACK_VALUE };

test("an enabled non-testnet still refuses without the explicit acknowledgement", () => {
  assert.throws(() => resolveNetwork(cfgWith(fake()), {}), /not a testnet.*HUSHRATE_MAINNET_ENABLE/);
  assert.throws(() => resolveNetwork(cfgWith(fake()), { [MAINNET_ACK_ENV]: "yes" }), /not a testnet/);
});

test("an enabled non-testnet with every value and the acknowledgement is accepted", () => {
  assert.equal(resolveNetwork(cfgWith(fake()), ack).testnet, false);
});

test("a single missing value refuses, and nothing is defaulted", () => {
  for (const over of [{ rpc_url: null }, { telegraph_node: null }, { expected_wallet: null }, { max_amount_per_payment: null }, { min_balance_units: null }, { assets: [] }] as Partial<NetworkConfig>[]) {
    assert.throws(() => resolveNetwork(cfgWith(fake(over)), ack), /missing/);
  }
});

test("an empty allow-list refuses: nothing may be paid", () => {
  assert.throws(() => resolveNetwork(cfgWith(fake({ assets: [] })), ack), /allow-list is empty/);
});

test("an asset without a payee, with a malformed address or listed twice refuses", () => {
  assert.throws(() => resolveNetwork(cfgWith(fake({ assets: [fakeAsset({ pay_to: null })] })), ack), /pay_to is not a valid address/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ assets: [fakeAsset({ pay_to: "0x12" })] })), ack), /pay_to is not a valid address/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ assets: [fakeAsset({ address: "0x1234" })] })), ack), /address is not a valid address/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ assets: [fakeAsset(), fakeAsset()] })), ack), /listed twice/);
});

test("malformed addresses, a mismatched chain id and a zero payment cap refuse", () => {
  assert.throws(() => resolveNetwork(cfgWith(fake({ expected_wallet: "not-an-address" })), ack), /valid address/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ caip2: "eip155:5" })), ack), /does not match/);
  assert.throws(() => resolveNetwork(cfgWith(fake({ max_amount_per_payment: "0" })), ack), /positive/);
});

test("an unknown active network refuses", () => {
  assert.throws(() => resolveNetwork({ active: "nope", networks: {} }, {}), /not defined/);
});
