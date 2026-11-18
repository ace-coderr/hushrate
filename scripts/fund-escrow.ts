// Funds Hushrate's Telegraph escrow once: approve the Diamond for the test USDC, then LedgerFacet.depositUSDC(amount).
// DRY RUN BY DEFAULT: prints the plan and sends nothing. Sends transactions only with --execute.
//   npx tsx scripts/fund-escrow.ts                       plan for 8 USDC
//   npx tsx scripts/fund-escrow.ts --amount 5            plan for 5 USDC
//   npx tsx scripts/fund-escrow.ts --execute             approve + deposit 8 USDC
// Every address below is checked against the live chain and the amount is capped. The key is read from the local .env
// (EVM_PRIVATE_KEY) and is never printed or written anywhere. Records go to data/deposits.json (public: hashes only).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, toFunctionSelector, formatUnits, parseUnits, getAddress, isAddressEqual } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
try { process.loadEnvFile(`${ROOT}.env`); } catch { /* env may already be set */ }

// Hard pins. These are not read from the config: a config typo must not be able to redirect a deposit.
const CHAIN_ID = 11155111;
const TOKEN = getAddress("0xcc194e1a843B658526D0D5C431f670028582Ae17");
const DIAMOND = getAddress("0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b");
const MAX_USDC = 8;
const DECIMALS = 6;

const cfg = JSON.parse(readFileSync(`${ROOT}config/networks.json`, "utf8")).networks.sepolia;
const WALLET = getAddress(cfg.expected_wallet);
const RPC: string = cfg.rpc_url;
const NODE: string = cfg.telegraph_node;
const EXPLORER: string = cfg.explorer_tx;

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const ai = args.indexOf("--amount");
const amountStr = ai >= 0 ? args[ai + 1] : "8";
if (!/^\d+(\.\d{1,6})?$/.test(amountStr ?? "")) throw new Error(`--amount must be a plain decimal USDC amount, got "${amountStr}"`);
const amount = parseUnits(amountStr, DECIMALS);
if (amount <= 0n || amount > parseUnits(String(MAX_USDC), DECIMALS)) throw new Error(`amount must be above 0 and at most ${MAX_USDC} USDC`);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
]);
const ledger = parseAbi(["function depositUSDC(uint256 amount)"]);
const loupe = parseAbi(["function facetAddress(bytes4 selector) view returns (address)"]);

const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const log = (s: string) => console.log(s);
const fail = (s: string): never => { console.error(`ABORT: ${s}`); process.exit(1); };

// --- hard checks -----------------------------------------------------------------------------------------------
const chainId = await pub.getChainId();
if (chainId !== CHAIN_ID) fail(`RPC reports chain ${chainId}, expected ${CHAIN_ID} (Ethereum Sepolia)`);
const code = await pub.getCode({ address: DIAMOND });
if (!code || code === "0x") fail(`no contract code at the Diamond ${DIAMOND}`);
const tokenCode = await pub.getCode({ address: TOKEN });
if (!tokenCode || tokenCode === "0x") fail(`no contract code at the token ${TOKEN}`);
const [symbol, decimals] = await Promise.all([
  pub.readContract({ address: TOKEN, abi: erc20, functionName: "symbol" }), pub.readContract({ address: TOKEN, abi: erc20, functionName: "decimals" }),
]);
if (Number(decimals) !== DECIMALS) fail(`token has ${decimals} decimals, expected ${DECIMALS}`);

// Is depositUSDC(uint256) a function of this Diamond? Ask the Diamond loupe which facet serves the selector.
const selector = toFunctionSelector("depositUSDC(uint256)");
let facet: string | null = null;
try { facet = await pub.readContract({ address: DIAMOND, abi: loupe, functionName: "facetAddress", args: [selector] }); } catch { facet = null; }
if (!facet || /^0x0+$/.test(facet)) fail(`the Diamond has no facet serving depositUSDC(uint256) (selector ${selector}); not depositing`);

const [eth, bal, allowance] = await Promise.all([
  pub.getBalance({ address: WALLET }),
  pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [WALLET] }),
  pub.readContract({ address: TOKEN, abi: erc20, functionName: "allowance", args: [WALLET, DIAMOND] }),
]);
const ledgerBefore = await fetch(`${NODE}/v1/ledger/account/${WALLET.toLowerCase()}`).then((r) => r.json()).catch(() => null) as { available?: string; deposited?: string } | null;

log(`Escrow funding plan (${execute ? "EXECUTE" : "DRY RUN, nothing is sent"})`);
log(`  chain        ${chainId} (Ethereum Sepolia)`);
log(`  wallet       ${WALLET}   ETH ${formatUnits(eth, 18)}`);
log(`  token        ${TOKEN}   ${symbol}, ${decimals} decimals, wallet holds ${formatUnits(bal, DECIMALS)}`);
log(`  spender/to   ${DIAMOND}   (the Telegraph Diamond; depositUSDC served by facet ${facet})`);
log(`  amount       ${formatUnits(amount, DECIMALS)} USDC (${amount} base units), cap ${MAX_USDC}`);
log(`  allowance    ${formatUnits(allowance, DECIMALS)} now`);
log(`  ledger       deposited ${ledgerBefore?.deposited ?? "?"}, available ${ledgerBefore?.available ?? "?"} (base units)`);
log(`  steps        1) ${symbol}.approve(Diamond, ${amount})   2) Diamond.depositUSDC(${amount})`);
if (bal < amount) fail(`wallet holds ${formatUnits(bal, DECIMALS)} ${symbol}, less than ${formatUnits(amount, DECIMALS)}`);
if (eth === 0n) fail("wallet has no ETH for gas");

// The approve can always be simulated. The deposit can only be simulated once the allowance exists; in a dry run with
// no allowance a revert is expected and says so, in --execute it is a hard stop.
const sim = async (a: ReturnType<typeof privateKeyToAccount> | `0x${string}`) =>
  pub.simulateContract({ account: a, address: DIAMOND, abi: ledger, functionName: "depositUSDC", args: [amount] });

if (!execute) {
  try { await sim(WALLET); log("  simulation   depositUSDC would succeed with the current allowance"); }
  catch (e) { log(`  simulation   depositUSDC reverts at the moment (${allowance >= amount ? "UNEXPECTED, allowance is enough" : "expected: the Diamond has no allowance yet"}): ${String((e as Error).message).split("\n")[0].slice(0, 160)}`); }
  log("\nDry run only. Re-run with --execute to approve and deposit.");
  process.exit(0);
}

// --- execute ---------------------------------------------------------------------------------------------------
const key = process.env.EVM_PRIVATE_KEY;
if (!key) fail("EVM_PRIVATE_KEY is not set in the local .env; nothing sent");
const account = privateKeyToAccount((key!.startsWith("0x") ? key! : `0x${key}`) as `0x${string}`);
if (!isAddressEqual(account.address, WALLET)) fail("the key in .env does not control the expected wallet; nothing sent");
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

let approveHash: `0x${string}` | null = null;
if (allowance < amount) {
  const a = await pub.simulateContract({ account, address: TOKEN, abi: erc20, functionName: "approve", args: [DIAMOND, amount] });
  approveHash = await wallet.writeContract(a.request);
  log(`  approve sent ${approveHash}`);
  const r = await pub.waitForTransactionReceipt({ hash: approveHash, confirmations: 2 });
  if (r.status !== "success") fail(`approve failed in block ${r.blockNumber}`);
  log(`  approve confirmed in block ${r.blockNumber}`);
} else log("  approve not needed, allowance already covers the amount");

let dep;
try { dep = await sim(account); } catch (e) { fail(`depositUSDC simulation reverted, nothing deposited: ${String((e as Error).message).split("\n")[0]}`); }
const depositHash = await wallet.writeContract(dep!.request);
log(`  deposit sent ${depositHash}`);
const rc = await pub.waitForTransactionReceipt({ hash: depositHash, confirmations: 2 });
if (rc.status !== "success") fail(`deposit failed in block ${rc.blockNumber}`);
log(`  deposit confirmed in block ${rc.blockNumber}`);

const file = `${ROOT}data/deposits.json`;
const list: unknown[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
list.push({
  at: new Date().toISOString(), network: "eip155:11155111", wallet: WALLET, token: TOKEN, diamond: DIAMOND,
  amount_uusdc: amount.toString(), amount_usdc: formatUnits(amount, DECIMALS),
  approve_tx: approveHash, deposit_tx: depositHash, deposit_block: Number(rc.blockNumber), explorer_tx: EXPLORER,
});
writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
log(`  recorded in data/deposits.json`);
log(`  ${EXPLORER}${depositHash}`);
