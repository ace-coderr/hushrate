// Fetches the FREE x402 challenge (HTTP 402) from Telegraph miners and verifies the asset it asks for on chain.
// Nothing is paid and nothing is signed: a request without a payment header only returns the challenge.
//   npx tsx scripts/payment-asset.mts
// Writes data/probe/payment-asset-<time>.json and prints a table.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NODE = (process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, "");
const RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org", "https://1rpc.io/sepolia", "https://rpc.sepolia.org"];
const WALLET = "0x3F857679462C80CC4Ffe99635aA3bd6e44FC913e"; // the public Hushrate test wallet (also in config/networks.json)

const tipRes = await fetch("https://blockstream.info/api/blocks/tip/height", { signal: AbortSignal.timeout(20000) });
const tip = Number((await tipRes.text()).trim());
if (!Number.isInteger(tip) || tip < 900000) throw new Error(`implausible tip ${tip}`);

const calls = [
  { miner: "71083", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: tip } },
  { miner: "1900999013", intent: "MINING_HASHPRICE_VERIFY_GENERAL", params: { block_height: tip } },
  { miner: "7320", intent: "CRYPTO_PRICE_USD", params: { symbol: "BTC" } },
  { miner: "router", intent: "CRYPTO_PRICE_USD", params: { symbol: "BTC" } },
];

interface Accept { scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds?: number; extra?: unknown; }
const results: any[] = [];
for (const c of calls) {
  const url = c.miner === "router" ? `${NODE}/engine/v1/ask` : `${NODE}/engine/v1/ask/${c.miner}`;
  const row: any = { miner: c.miner, intent: c.intent, url };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: c.intent, params: c.params }), signal: AbortSignal.timeout(30000) });
    row.http_status = r.status;
    const h = r.headers.get("payment-required");
    if (h) {
      const ch = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
      row.x402Version = ch.x402Version;
      row.accepts = (ch.accepts as Accept[]).map((a) => ({ scheme: a.scheme, network: a.network, asset: a.asset, amount: a.amount, payTo: a.payTo, maxTimeoutSeconds: a.maxTimeoutSeconds, extra: a.extra }));
    } else row.body = (await r.text()).slice(0, 300);
  } catch (e) { row.error = String(e); }
  results.push(row);
}

async function rpc(url: string, method: string, params: unknown[]) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result as string;
}
const decodeString = (hex: string) => { const b = Buffer.from(hex.slice(2), "hex"); const len = Number(BigInt("0x" + b.subarray(32, 64).toString("hex"))); return b.subarray(64, 64 + len).toString("utf8"); };

const assets = [...new Set(results.flatMap((r) => (r.accepts ?? []).filter((a: Accept) => a.network === "eip155:11155111" && typeof a.asset === "string").map((a: Accept) => a.asset.toLowerCase())))];
assets.push("0xcc194e1a843b658526d0d5c431f670028582ae17"); // the previous asset, for comparison
const onchain: any[] = [];
for (const asset of [...new Set(assets)]) {
  const row: any = { asset };
  for (const url of RPCS) {
    try {
      const code = await rpc(url, "eth_getCode", [asset, "latest"]);
      row.has_code = code !== "0x";
      row.symbol = decodeString(await rpc(url, "eth_call", [{ to: asset, data: "0x95d89b41" }, "latest"]));
      row.name = decodeString(await rpc(url, "eth_call", [{ to: asset, data: "0x06fdde03" }, "latest"]));
      row.decimals = Number(BigInt(await rpc(url, "eth_call", [{ to: asset, data: "0x313ce567" }, "latest"])));
      row.total_supply = BigInt(await rpc(url, "eth_call", [{ to: asset, data: "0x18160ddd" }, "latest"])).toString();
      const bal = BigInt(await rpc(url, "eth_call", [{ to: asset, data: "0x70a08231" + WALLET.slice(2).toLowerCase().padStart(64, "0") }, "latest"]));
      row.wallet_balance_units = bal.toString();
      row.wallet_balance = Number(bal) / 10 ** row.decimals;
      row.rpc = url;
      break;
    } catch (e) { row.last_error = String(e); }
  }
  onchain.push(row);
}

const out = { fetched_at: new Date().toISOString(), tip_used: tip, node: NODE, wallet: WALLET, challenges: results, onchain };
mkdirSync(`${ROOT}data/probe`, { recursive: true });
const file = `data/probe/payment-asset-${out.fetched_at.replace(/[:.]/g, "-")}.json`;
writeFileSync(`${ROOT}${file}`, JSON.stringify(out, null, 2) + "\n");

console.log(`challenges fetched at ${out.fetched_at} (block_height ${tip}); nothing paid`);
for (const r of results) {
  console.log(`\n${r.miner} ${r.intent}: HTTP ${r.http_status ?? "n/a"}${r.error ? " " + r.error : ""}${r.body ? " " + r.body : ""}`);
  for (const a of r.accepts ?? []) console.log(`  ${a.scheme} ${a.network} asset ${a.asset} amount ${a.amount} payTo ${a.payTo} extra ${JSON.stringify(a.extra)}`);
}
console.log("\non chain:");
for (const o of onchain) console.log(`  ${o.asset}: code=${o.has_code} symbol=${o.symbol} name=${o.name} decimals=${o.decimals} supply=${o.total_supply} wallet=${o.wallet_balance} (via ${o.rpc ?? "no RPC reachable: " + o.last_error})`);
console.log(`\nsaved ${file}`);
