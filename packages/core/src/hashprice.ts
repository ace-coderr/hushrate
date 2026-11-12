// Public hashprice from mempool.space. Works in Node and in the browser (mempool.space allows CORS).

export const BLOCKS_PER_DAY = 144;
const MEMPOOL = "https://mempool.space/api";

export interface BlockRow { height: number; difficulty: number; reward_sats: number; timestamp: number; }

export interface HashpriceWindow {
  blocks: number;
  from_height: number;
  to_height: number;
  hashprice_sats_per_ph_day: number;
  /** Lowest and highest single-block value in the window, to show how noisy one block is. */
  min_block: number;
  max_block: number;
}

/**
 * Expected sats earned per PH/s per day at one block's reward and difficulty.
 * Expected hashes per block = difficulty * 2^32; one PH/s for a day is 1e15 * 86400 hashes.
 */
export function blockHashprice(reward_sats: number, difficulty: number): number {
  return (reward_sats * 1e15 * 86400) / (difficulty * 2 ** 32);
}

/** Mean of the single-block values over a window. Throws on an empty or invalid window. */
export function windowHashprice(rows: BlockRow[]): HashpriceWindow {
  if (!rows.length) throw new Error("no blocks");
  const vals = rows.map((r) => {
    if (!(r.reward_sats > 0) || !(r.difficulty > 0)) throw new Error(`invalid block ${r.height}`);
    return blockHashprice(r.reward_sats, r.difficulty);
  });
  const heights = rows.map((r) => r.height);
  return {
    blocks: rows.length,
    from_height: Math.min(...heights),
    to_height: Math.max(...heights),
    hashprice_sats_per_ph_day: vals.reduce((a, b) => a + b, 0) / vals.length,
    min_block: Math.min(...vals),
    max_block: Math.max(...vals),
  };
}

async function getJson(url: string, f: typeof fetch): Promise<any> {
  const r = await f(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

export async function fetchTipHeight(f: typeof fetch = fetch): Promise<number> {
  const r = await f(`${MEMPOOL}/blocks/tip/height`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`tip height -> HTTP ${r.status}`);
  const h = Number((await r.text()).trim());
  if (!Number.isInteger(h) || h <= 0) throw new Error("invalid tip height");
  return h;
}

export async function fetchBtcUsd(f: typeof fetch = fetch): Promise<number> {
  const p = (await getJson(`${MEMPOOL}/v1/prices`, f)).USD;
  if (typeof p !== "number" || !(p > 0)) throw new Error("invalid BTC/USD price");
  return p;
}

/** The `count` blocks ending at `tip` (inclusive), newest first. mempool.space returns 15 per request. */
export async function fetchBlocks(tip: number, count = BLOCKS_PER_DAY, f: typeof fetch = fetch): Promise<BlockRow[]> {
  const out: BlockRow[] = [];
  let h = tip;
  while (out.length < count && h > 0) {
    const page = await getJson(`${MEMPOOL}/v1/blocks/${h}`, f);
    if (!Array.isArray(page) || !page.length) throw new Error(`empty block page at ${h}`);
    for (const b of page) {
      if (out.length >= count) break;
      out.push({ height: b.height, difficulty: b.difficulty, reward_sats: b.extras?.reward, timestamp: b.timestamp });
    }
    h = page[page.length - 1].height - 1;
  }
  if (out.length < count) throw new Error(`only ${out.length} of ${count} blocks available`);
  return out;
}

/** Convenience: public hashprice over the last 144 blocks ending at `tip`. */
export async function publicHashprice(tip: number, f: typeof fetch = fetch): Promise<HashpriceWindow & { tip: number }> {
  const rows = await fetchBlocks(tip, BLOCKS_PER_DAY, f);
  return { tip, ...windowHashprice(rows) };
}
