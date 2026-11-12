// Read-only wallet check on Ethereum Sepolia. Sends no transaction.
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { pathToFileURL } from "node:url";
import { sepolia } from "viem/chains";

export const WALLET = "0x3F857679462C80CC4Ffe99635aA3bd6e44FC913e" as const;
export const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17" as const;
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";

export async function balances() {
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: WALLET }),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [WALLET] }),
  ]);
  return { eth: formatEther(eth), usdc: formatUnits(usdc, 6), usdcRaw: usdc.toString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const b = await balances();
  console.log(`Wallet ${WALLET} (Ethereum Sepolia, chain 11155111)`);
  console.log(`  ETH : ${b.eth}`);
  console.log(`  USDC: ${b.usdc} (test token)`);
}
