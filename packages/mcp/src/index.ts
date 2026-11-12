#!/usr/bin/env node
// Hushrate MCP server (stdio). Reads the published JSON; needs no key and no wallet.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { MarketTape } from "@hushrate/core";
import { decideFromTape, receiptsView, summarizeMarket } from "./tools.js";

const BASE = (process.env.HUSHRATE_DATA_URL ?? "https://ace-coderr.github.io/hushrate/data").replace(/\/$/, "");

async function get<T>(file: string): Promise<T> {
  const r = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(20000), headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`${BASE}/${file} returned HTTP ${r.status}`);
  return (await r.json()) as T;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `Hushrate data unavailable: ${(e as Error).message}. Nothing was guessed.` }] });

const server = new McpServer({ name: "hushrate", version: "0.1.0" });

server.registerTool(
  "hushrate_market",
  { description: "Latest hourly market tape: Bitcoin hashprice (with source and verification label), BTC price, and CAISO power prices per node (real-time when available, else day-ahead). Testnet-paid data." },
  async () => { try { return text(summarizeMarket(await get<MarketTape>("latest.json"))); } catch (e) { return fail(e); } },
);

server.registerTool(
  "hushrate_decide",
  {
    description: "Decide RUN, CURTAIL or HOLD for one mining site against the latest tape. Returns margin per day and the breakeven power price. HOLD when any input is missing.",
    inputSchema: {
      node: z.string().describe("CAISO pricing node on the tape, e.g. TH_SP15_GEN-APND"),
      power_mw: z.number().positive().describe("Continuous electrical load of the fleet in MW"),
      efficiency_j_per_th: z.number().positive().describe("Fleet efficiency in joules per terahash"),
      power_adder_usd_per_mwh: z.number().optional().describe("Delivery, fees and overhead on top of the market price, $/MWh (default 0)"),
      min_margin_usd_per_day: z.number().optional().describe("Run only if margin is above this, $/day (default 0)"),
      name: z.string().optional().describe("Optional site label"),
    },
  },
  async (args) => { try { return text(decideFromTape(await get<MarketTape>("latest.json"), args)); } catch (e) { return fail(e); } },
);

server.registerTool(
  "hushrate_receipts",
  {
    description: "Ledger of paid data requests (test USDC on Ethereum Sepolia): cost, miner, receipt hash and settlement transaction hash. Newest first.",
    inputSchema: { limit: z.number().int().positive().max(200).optional().describe("How many rows to return (default 20)") },
  },
  async ({ limit }) => { try { return text(receiptsView(await get<{ at: string }[]>("ledger.json"), limit ?? 20)); } catch (e) { return fail(e); } },
);

await server.connect(new StdioServerTransport());
