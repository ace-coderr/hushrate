// Free, read-only probe of Telegraph's escrow rail: the 402 challenge for each pinned miner and the wallet's ledger balance.
// Sends no payment and signs nothing. Run: npx tsx scripts/escrow-probe.mts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const NODE = "https://devnode.telegraphprotocol.com";
const cfg = JSON.parse(readFileSync(new URL("../config/networks.json", import.meta.url), "utf8")).networks.sepolia;
const wallet = String(cfg.expected_wallet).toLowerCase();
const calls: [string, string, Record<string, unknown>][] = [
  ["71083", "MINING_HASHPRICE_VERIFY_GENERAL", { block_height: 976000 }],
  ["7320", "CRYPTO_PRICE_USD", { symbol: "BTC" }],
];
const out: Record<string, unknown> = { at: new Date().toISOString(), wallet };
for (const [miner, intent, params] of calls) {
  const res = await fetch(`${NODE}/engine/v1/ask/${miner}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, params }) });
  const h = res.headers.get("payment-required");
  const body = await res.text();
  let accepts: unknown[] = [];
  try { accepts = JSON.parse(h ? Buffer.from(h, "base64").toString("utf8") : body).accepts ?? []; } catch { /* keep empty */ }
  out[miner] = { status: res.status, via: h ? "PAYMENT-REQUIRED header" : "body", accepts };
}
const l = await fetch(`${NODE}/v1/ledger/account/${wallet}`);
out.ledger = { status: l.status, body: await l.json().catch(() => null) };
mkdirSync(new URL("../data/probe/", import.meta.url), { recursive: true });
const f = new URL(`../data/probe/escrow-${String(out.at).replace(/[:.]/g, "-")}.json`, import.meta.url);
writeFileSync(f, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 1));
