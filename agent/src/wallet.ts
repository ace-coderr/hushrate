// Read-only wallet check on the active network (Sepolia unless config/networks.json says otherwise). Sends no transaction.
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { pathToFileURL } from "node:url";
import { loadNetwork } from "./network.js";

const net = loadNetwork();
export const WALLET = net.expected_wallet;
export const USDC = net.usdc.address;
export const RPC = net.rpc_url;

const CHAINS = { 1: mainnet, 11155111: sepolia } as const;
const chain = CHAINS[net.chain_id as keyof typeof CHAINS];
if (!chain) throw new Error(`NETWORK CONFIG: chain_id ${net.chain_id} is not supported by this build`);

export async function balances() {
  const client = createPublicClient({ chain, transport: http(RPC) });
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: WALLET }),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [WALLET] }),
  ]);
  return { eth: formatEther(eth), usdc: formatUnits(usdc, net.usdc.decimals), usdcRaw: usdc.toString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const b = await balances();
  console.log(`Wallet ${WALLET} (${net.label}, chain ${net.chain_id})`);
  console.log(`  ETH : ${b.eth}`);
  console.log(`  USDC: ${b.usdc}${net.testnet ? " (test token)" : ""}`);
}
