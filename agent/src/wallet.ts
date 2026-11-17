// Read-only wallet check on the active network (Sepolia unless config/networks.json says otherwise). Sends no transaction.
// Reads the balance of EVERY allowed payment asset: the node decides which one it asks for, so each must be known.
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { pathToFileURL } from "node:url";
import { loadNetwork } from "./network.js";

const net = loadNetwork();
export const WALLET = net.expected_wallet;
export const ASSETS = net.assets;
export const RPC = net.rpc_url;

const CHAINS = { 1: mainnet, 11155111: sepolia } as const;
const chain = CHAINS[net.chain_id as keyof typeof CHAINS];
if (!chain) throw new Error(`NETWORK CONFIG: chain_id ${net.chain_id} is not supported by this build`);

export interface AssetBalance { asset: string; symbol: string; role: string; decimals: number; raw: string; formatted: string; }

export async function balances() {
  const client = createPublicClient({ chain, transport: http(RPC) });
  const [eth, ...tokens] = await Promise.all([
    client.getBalance({ address: WALLET }),
    ...ASSETS.map((a) => client.readContract({ address: a.address, abi: erc20Abi, functionName: "balanceOf", args: [WALLET] })),
  ]);
  const assets: AssetBalance[] = ASSETS.map((a, i) => ({
    asset: a.address, symbol: a.symbol, role: a.role, decimals: a.decimals,
    raw: (tokens[i] as bigint).toString(), formatted: formatUnits(tokens[i] as bigint, a.decimals),
  }));
  return { eth: formatEther(eth as bigint), assets };
}

/** Balances keyed by lower-case asset address, in base units, for the payment assessment. */
export const unitsByAsset = (b: { assets: AssetBalance[] }) => Object.fromEntries(b.assets.map((a) => [a.asset.toLowerCase(), BigInt(a.raw)]));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const b = await balances();
  console.log(`Wallet ${WALLET} (${net.label}, chain ${net.chain_id})`);
  console.log(`  ETH : ${b.eth}`);
  for (const a of b.assets) console.log(`  ${a.symbol}: ${a.formatted}  ${a.asset} (${a.role})${net.testnet ? " test token" : ""}`);
}
