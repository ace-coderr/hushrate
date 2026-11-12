// Free discovery: fetch intent schemas and miner listings. No payment involved.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NODE = (process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, "");
const INTENTS = [
  "GRID_POWER_PRICE_GENERAL",
  "MINING_HASHPRICE_VERIFY_GENERAL",
  "DATACENTER_TELEMETRY_VERIFY_GENERAL",
  "SLA_COMPLIANCE_GENERAL",
];
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = `${ROOT}data/discovery`;
mkdirSync(OUT, { recursive: true });

async function save(file: string, url: string): Promise<void> {
  try {
    const res = await fetch(url);
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    writeFileSync(`${OUT}/${file}`, JSON.stringify({ url, status: res.status, body }, null, 2));
    console.log(`${res.status} ${url} -> data/discovery/${file}`);
  } catch (e) {
    writeFileSync(`${OUT}/${file}`, JSON.stringify({ url, error: String(e) }, null, 2));
    console.log(`ERR ${url}: ${e}`);
  }
}

for (const name of INTENTS) {
  await save(`${name}.intent.json`, `${NODE}/engine/v1/intents/${name}`);
  await save(`${name}.miners.json`, `${NODE}/api/miners?intent=${name}`);
}
