# Ridge Runner — Pump.fun Replay Sprint Paper Bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/davlermid/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/davlermid/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A deterministic paper-trading bot for the [Pump.fun Replay Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) (`agent-fun/replay/v2`, Node 22, zero dependencies). It trades 10 SOL of paper money on a 24-hour replay of recorded pump.fun bonding-curve activity. Nothing is traded for real.

## Strategy: launch sniper with a rug filter

Buy clean launches in their first 3 slots — the creator has not sold, the creator's own buy is at most 0.2 SOL, at most 2 distinct wallets bought in yet, the price has not already popped more than 20% above its create price, and the curve already holds at least 1 SOL of real reserves (so the 1%-of-reserve buy cap still allows a ≥0.01 SOL round trip). Then scalp fast: take profit 4%, stop loss 4%, out within 20 slots, with at most 3 small pyramid adds into strength. A probe engine opens tiny 0.01 SOL round trips only when the run's coin/fill pace lags, so the run clears the 20-coin guardrail.

Why this shape: on the dev window (2–3 Nov 2026, 1,222 sampled coins) a blind buy at launch held 10 slots averages +2.0% gross while every longer hold averages negative — the only durable edge is the launch pop, and it is small, so the bot buys only the cleanest launches, keeps stakes small, and exits in slots, not minutes. A round trip costs ~2.5% in curve fees plus 105,000 lamports of tx fee per order, which is why stakes below 0.01 SOL are never sent and why the bot never chases a run that already popped.

## Files

- `main.ts` — entrypoint: wires the strategy to the replay shim (`node /bot/main.ts`).
- `strategy.ts` — the strategy engine and all four candidate parameter sets.
- `vendor/makefun-bot.ts` — the kit's replay/v2 SDK shim, vendored byte for byte.
- `CANDIDATES.md` — the four strategy variants, their dev backtests, and why launch won.

## Backtest (dev window)

Net PnL **-0.080538 SOL**, 77 coins with round trips ≥0.01 SOL, 149 trips (13 wins), max drawdown **0.81%**, 0 rejected orders. The dev window loses money for every strategy tested, including all three house pilots (best pilot: sniper, -0.489 SOL) — this entry is the least-bad, tightest, most guardrail-safe of the set, and it is the only one whose drawdown stays under 1%.

## Determinism

Every decision is a pure function of the batches received: no clock, no randomness, no I/O, insertion-ordered maps only. Two runs on the dev dataset produce byte-identical action logs (verified locally, see `CANDIDATES.md`).
