## Diagnosis

Analysis of the recorded tapes up to 2026-11-14 07:17 UTC. Every number above is computed from `data/market/`, `data/receipts/` and cached block data; the hypotheses were tested with free chain reads and no payments.

**Miner 71083 was accurate in every one of the recorded purchases. The comparison the agent used was wrong.**

1. **The miner computes one block.** Its value equals the public hashprice of the single block at the height it returned in 38 of 38 purchases, with a median difference of 0.00% and a worst difference of 0.00% (table (c), k = 0). Its answer is the latest block, with no lag: the neighbouring blocks (k = -2, -1, 1, 2, 3) are all worse, with medians of 0.29% to 0.61%.
2. **It is the standard formula, exactly.** The implied constant in `value = reward x K / hashrate` is 144.0 for all 38 purchases, which is 86,400 seconds divided by the 600-second target block time, so it is the same quantity as `reward x 1e15 x 86400 / (difficulty x 2^32)`. (The recorded `hashrate_eh_s` field is the difficulty-implied hashrate.)
3. **The window hypothesis (a) is the answer, in the limiting case.** A window of N = 1 block matches with a median error of 0.00%. Every wider window is worse: 0.45% median and 9.64% worst for the 144-block mean the agent used, and 0.14% to 0.55% medians in between. No wider window fits better, so the miner is not using a longer one.
4. **The definition hypotheses (b) do not fit.** Subsidy-only (fees excluded) is off by a median of 0.81%, so the miner includes fees. Pricing the block at the previous block's difficulty cannot be separated from the current one in this data, because difficulty changed at only one block in the range.
5. **Fee spikes (d) do not explain the large gaps.** The correlation between a block's fee share and its distance from the 144-block mean is r = -0.03. The large gaps come from a difficulty adjustment.

**Why the 144-block comparison rejected accurate values.** Two separate effects:

- **A difficulty adjustment (3 purchases, 9.4% median gap, 0 of 3 accepted).** At block 975744 difficulty fell 9.13% (148.36T to 134.82T). The agent's 144-block mean prices each block at its own difficulty, so for about a day after an adjustment it averages blocks from two regimes and understates the current hashprice by up to the size of the step. Telegraph's single block, at the current difficulty, was correct. The same will happen after every retarget (about every two weeks) in either direction.
- **Ordinary fee noise (6 purchases, 1.05% to 1.78% gaps).** A single block's fees differ from the average fees of 144 blocks by a percent or two. Comparing one block with a mean and demanding 1% rejects honest values.

Without the adjustment, 29 of the 35 purchases were accepted (82.9%); the six rejections are the fee-noise cases.

## What changed

- **Same quantity on both sides.** From 2026-11-14 the Telegraph value is checked against the public hashprice of the single block at the height the miner returned, with the same required fields and the same stale-height check. **The 1% limit is unchanged.** Applied retroactively to the 38 recorded purchases, this rule accepts 38 of 38 (and 26 of 26 in the last 24 hours); the agent's earlier rule accepted 29 of 38 (76.3%) and 17 of 26 (65.4%). That "after" figure is a replay on recorded data, not a new measurement: the live rate is reported once enough hours have run.
- **The public fallback uses the same definition.** When Telegraph is unavailable or rejected, the agent now falls back to the public single-block value at the tip, not to the 144-block mean, so the number does not change meaning when the source changes. The 144-block mean stays on the tape as context.
- **A labelled fallback miner.** Primary stays 71083. Fallback is 1900999013 (MetricWire, ranked 2 for this intent), tried only if the primary signed no payment (removed, refused before payment). If a payment was signed it may have settled, so hashprice is never bought twice in one hour. Old tapes keep their rule: the Proof page re-applies the rule that was in force when each tape was recorded.
- **Other miners.** Of five probed, two returned a value that equals the public single-block value exactly at the same block (74183 and 1900999013, which share an operator's host), one refused before payment (9002: no `block_height` input), one answered in free text with no fields (501), and one lost its response after the payment was signed (20260828). Nothing agreed better than 71083, which already agreed exactly across 38 purchases.

## Limits of this finding

- A single block's value includes that block's fees, so it is noisier than a smoothed figure. In the recorded range the single block stayed within 1.78% of the 144-block mean when no adjustment was in the window. A block with an unusually large fee would move the hashprice used for decisions by more than that; the tape keeps the 144-block mean beside it so that a gap is visible.
- One difficulty adjustment is the only one in the recorded range, so the "previous block's difficulty" variant cannot be told apart from the current one.
- The probe of other miners is one sample each at one block.

## An incident found while doing this

Two hourly runs at 2026-11-13 16:17 and 16:20 UTC both bought hashprice and the BTC price for the same hour (four payments, $0.04, instead of two). The ticker run and a scheduled run were created from the same commit before the first run's data commit landed; the second waited in the workflow's concurrency queue, then checked out the commit it was triggered from, so it could not see the first run's purchases and the same-hour guard had nothing to find. The record job now checks out `main` as it is when it starts. The two duplicate purchases are in the ledger and in the table above.
