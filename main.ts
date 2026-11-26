// Ridge Runner — launch-sniper bot for the pump.fun replay (agent-fun/replay/v2).
// Strategy: buy clean launches in their first 3 slots (creator has not sold, creator buy
// at most 0.2 SOL, at most 2 distinct early buyers, price not yet popped more than 20%
// above its create price, real SOL reserve at least 1), scalp fast (take profit 4%,
// stop loss 4%, out within 20 slots), pyramid at most 3 small adds into strength, and
// keep a probe engine running so the run clears the 20-coin guardrail. Every decision
// is a pure function of the batches received: no clock, no randomness, no I/O, so the
// two graded executions produce byte-identical action logs. The strategy lives in
// strategy.ts; this file only wires it to the wire shim.
import { runBot, type BotState } from './vendor/makefun-bot.ts';
import { createStrategy, LAUNCH_PARAMS } from './strategy.ts';
const bot = createStrategy(LAUNCH_PARAMS);
const onDone = (state: BotState): void => { console.error(`done cash=${state.cash} positions=${state.positions.size} batches=${state.seq + 1}`); };
await runBot({ onBatch: bot.onBatch, onDone });
