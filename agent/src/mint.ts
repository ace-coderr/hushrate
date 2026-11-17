// Mints Sepolia TEST USDC to the Hushrate wallet via mint(address,uint256), for an allow-listed asset that is mintable.
// Sends a transaction, so it does nothing unless run with --confirm.
//   tsx src/mint.ts --confirm [amount_usdc]     default 15
// Circle's test USDC cannot be minted here: fund it from https://faucet.circle.com/ (Ethereum Sepolia, USDC).
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseUnits, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { balances, WALLET, RPC } from "./wallet.js";
import { loadNetwork } from "./network.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
try { process.loadEnvFile(`${ROOT}.env`); } catch { /* env may already be set */ }

const net = loadNetwork();
if (!net.testnet) throw new Error("mint is for test tokens only and refuses to run on a non-testnet network");
const target = net.assets.find((a) => a.mintable);
if (!target) {
  console.log("None of the allowed assets can be minted by this script.");
  console.log("Fund the wallet from Circle's faucet: https://faucet.circle.com/ (network: Ethereum Sepolia, token: USDC), address " + WALLET);
  process.exit(0);
}
const MAX_USDC = 20; // hard ceiling per invocation
const amount = Number(process.argv.find((a, i) => i > 1 && /^\d+(\.\d+)?$/.test(a)) ?? "15");
if (!(amount > 0 && amount <= MAX_USDC)) throw new Error(`amount must be above 0 and at most ${MAX_USDC}`);

const before = await balances();
console.log(`Sepolia only. Wallet ${WALLET}: ${before.eth} ETH`);
for (const a of before.assets) console.log(`  ${a.symbol} ${a.formatted} ${a.asset} (${a.role})`);
console.log(`Plan: mint ${amount} ${target.symbol} on ${target.address} (${target.role}). Telegraph only accepts it if its 402 asks for this asset.`);
if (!process.argv.includes("--confirm")) { console.log("Dry run. Re-run with --confirm to send the transaction."); process.exit(0); }

const key = process.env.EVM_PRIVATE_KEY;
if (!key) throw new Error("EVM_PRIVATE_KEY is not set");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
if (account.address.toLowerCase() !== WALLET.toLowerCase()) throw new Error("key does not control the expected wallet");

const abi = parseAbi(["function mint(address to, uint256 amount)"]);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const { request } = await pub.simulateContract({ account, address: target.address, abi, functionName: "mint", args: [WALLET, parseUnits(String(amount), target.decimals)] });
const hash = await wallet.writeContract(request);
console.log(`sent ${hash}`);
const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log(`status ${rcpt.status} in block ${rcpt.blockNumber}`);
const after = await balances();
for (const a of after.assets) console.log(`wallet after: ${a.symbol} ${a.formatted} ${a.asset}`);
