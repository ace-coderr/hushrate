// Network settings come from config/networks.json. Sepolia (testnet) is the only network that runs.
// A non-testnet entry refuses to run unless it is enabled in the file, EVERY value is supplied explicitly, and the
// environment carries an explicit acknowledgement. Nothing is defaulted or guessed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface NetworkConfig {
  label: string;
  testnet: boolean;
  enabled: boolean;
  caip2: string | null;
  chain_id: number | null;
  rpc_url: string | null;
  usdc: { address: string | null; decimals: number };
  telegraph_node: string | null;
  expected_wallet: string | null;
  explorer_tx: string | null;
  max_amount_per_payment: string | null;
  max_paid_calls_per_run: number | null;
  min_balance_units: string | null;
}

/** A fully validated network: no nulls left. */
export interface Network {
  name: string;
  label: string;
  testnet: boolean;
  caip2: `${string}:${string}`;
  chain_id: number;
  rpc_url: string;
  usdc: { address: `0x${string}`; decimals: number };
  telegraph_node: string;
  expected_wallet: `0x${string}`;
  explorer_tx: string;
  max_amount_per_payment: string;
  max_paid_calls_per_run: number;
  min_balance_units: bigint;
}

export const MAINNET_ACK_ENV = "HUSHRATE_MAINNET_ENABLE";
export const MAINNET_ACK_VALUE = "I_UNDERSTAND_THIS_USES_REAL_MONEY";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Prefix is matched by the agent's fatal-error check: a refused network is a real failure, never a degraded run. */
export const NETWORK_ERROR = "NETWORK CONFIG";

export function resolveNetwork(cfg: { active: string; networks: Record<string, NetworkConfig> }, env: Record<string, string | undefined>): Network {
  const name = cfg.active;
  const n = cfg.networks[name];
  if (!n) throw new Error(`${NETWORK_ERROR}: active network "${name}" is not defined`);
  if (!n.enabled) throw new Error(`${NETWORK_ERROR}: network "${name}" is disabled (enabled: false); refusing to run`);

  const missing: string[] = [];
  const need = (k: string, v: unknown) => { if (v === null || v === undefined || v === "") missing.push(k); };
  need("caip2", n.caip2); need("chain_id", n.chain_id); need("rpc_url", n.rpc_url); need("usdc.address", n.usdc?.address);
  need("telegraph_node", n.telegraph_node); need("expected_wallet", n.expected_wallet); need("explorer_tx", n.explorer_tx);
  need("max_amount_per_payment", n.max_amount_per_payment); need("max_paid_calls_per_run", n.max_paid_calls_per_run); need("min_balance_units", n.min_balance_units);
  if (missing.length) throw new Error(`${NETWORK_ERROR}: network "${name}" is missing ${missing.join(", ")}; refusing to run (nothing is defaulted)`);

  if (!ADDRESS.test(n.usdc.address!)) throw new Error(`${NETWORK_ERROR}: usdc.address is not a valid address`);
  if (!ADDRESS.test(n.expected_wallet!)) throw new Error(`${NETWORK_ERROR}: expected_wallet is not a valid address`);
  if (n.caip2 !== `eip155:${n.chain_id}`) throw new Error(`${NETWORK_ERROR}: caip2 ${n.caip2} does not match chain_id ${n.chain_id}`);
  if (!/^\d+$/.test(n.max_amount_per_payment!) || BigInt(n.max_amount_per_payment!) <= 0n) throw new Error(`${NETWORK_ERROR}: max_amount_per_payment must be a positive integer string`);

  if (!n.testnet && env[MAINNET_ACK_ENV] !== MAINNET_ACK_VALUE) {
    throw new Error(`${NETWORK_ERROR}: "${name}" is not a testnet. It refuses to run unless ${MAINNET_ACK_ENV}=${MAINNET_ACK_VALUE} is set. Hushrate is NOT live on mainnet.`);
  }

  return {
    name, label: n.label, testnet: n.testnet, caip2: n.caip2 as `${string}:${string}`, chain_id: n.chain_id!, rpc_url: n.rpc_url!,
    usdc: { address: n.usdc.address as `0x${string}`, decimals: n.usdc.decimals }, telegraph_node: n.telegraph_node!.replace(/\/$/, ""),
    expected_wallet: n.expected_wallet as `0x${string}`, explorer_tx: n.explorer_tx!, max_amount_per_payment: n.max_amount_per_payment!,
    max_paid_calls_per_run: n.max_paid_calls_per_run!, min_balance_units: BigInt(n.min_balance_units!),
  };
}

let cached: Network | null = null;
/** The active network from config/networks.json. TELEGRAPH_NODE in the environment may override the node URL. */
export function loadNetwork(): Network {
  if (cached) return cached;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const cfg = JSON.parse(readFileSync(`${root}config/networks.json`, "utf8"));
  const net = resolveNetwork(cfg, process.env);
  const override = process.env.TELEGRAPH_NODE;
  cached = override ? { ...net, telegraph_node: override.replace(/\/$/, "") } : net;
  return cached;
}
