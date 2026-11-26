# Candidates — Pump.fun Replay Sprint Paper Bot

Dev window: kit dataset, 24 h, 2–3 Nov 2026 (128,058 events, 1,222 sampled coins,
35 completions, 63,369 batches). All numbers below are local backtests with the kit's
own sim port (`baselines/pilot/momentum/tools/sim.ts`, seed from `phaseSeed`, failed-tx
draw on). A round trip counts toward the guardrail when the coin's total buy is
≥0.01 SOL. Guardrail: ≥20 such coins and max drawdown ≤50%.

## What the data says first

A blind buy at a coin's create price, held N slots (gross, before fees):

| Buy at age | Hold (slots) | Mean return | Median | Win > +3% |
|---|---:|---:|---:|---:|
| 0 | 10 | +2.0% | 0.0% | 18.2% |
| 0 | 50 | −0.4% | 0.0% | 19.8% |
| 0 | 200 | −3.0% | −0.0% | 16.2% |
| 50 | 200 | −3.1% | 0.0% | 11.6% |
| 100 | 500 | −2.4% | −0.0% | 9.3% |
| 300 | 1000 | −2.9% | −0.0% | 5.3% |

286 coins reach 2x their create price at some point, 145 reach 3x, 80 reach 5x,
46 reach 10x — but the median coin goes nowhere and every hold longer than ~10
slots averages negative. The only durable edge is the launch pop, and it is small:
a round trip costs ~2.5% in curve fees plus 105,000 lamports of tx fee per order,
so a 0.01 SOL stake needs a >4.6% move just to break even. Every variant below
was designed around that fact.

## House pilot baselines (for comparison)

| Baseline | Net PnL (SOL) | Fills | Coins | Trips | Wins | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| momentum pilot | −9.387258 | 410 | 48 | 80 | 5 | 0.9502 |
| reversion pilot | −4.016371 | 2,316 | 198 | 424 | 111 | 0.4892 |
| sniper pilot | −0.488737 | 848 | 354 | 354 | 45 | 0.0533 |

All three pilots lose money on the dev window; sniper is the least bad.

## My variants (one shared engine, `strategy.ts`)

| Variant | Net PnL (SOL) | Fills | Coins | Trips | Wins | Max DD | Guardrail |
|---|---:|---:|---:|---:|---:|---:|---|
| breakout — break above the 200-slot high on accelerating inflow, pyramid into strength, TP 50% / SL 12% / trail 25%, hold ≤1200 | −2.375005 | 558 | 127 | 220 | 25 | 0.2891 | pass |
| dip — buy a 20–50% pullback from the 1000-slot high on liquid curves (real SOL ≥10), one 0.2 SOL tranche, TP 18% / SL 10%, hold ≤500 | −0.801381 | 372 | 98 | 186 | 29 | 0.0960 | pass |
| dip, stricter (dip ≥30%, real SOL ≥15, TP 35%) | −0.625910 | 322 | 81 | 161 | 18 | 0.0695 | pass |
| dip, mature (real SOL ≥25, dip ≥25%, TP 25% / SL 8%, hold ≤800) | −0.488369 | 296 | 74 | 148 | 14 | 0.0550 | pass |
| surge — buy a ≥15% rise in 40 slots with strong inflow (≥0.5 SOL) and ≥6 buyers, 0.1 SOL, TP 20% / SL 8%, hold ≤250 | −0.862973 | 526 | 159 | 263 | 46 | 0.0881 | pass |
| surge, mature (age ≥200, real SOL ≥10, TP 25% / SL 8%, hold ≤400) | −0.758284 | 434 | 117 | 217 | 31 | 0.0810 | pass |
| launch — buy in the first 3 slots, no rug filter, TP 8% / SL 6%, hold ≤12 | −0.393861 | 704 | 323 | 352 | 40 | 0.0420 | pass |
| launch, micro exits (TP 4% / SL 4%, hold ≤8) | −0.372609 | 704 | 323 | 352 | 37 | 0.0398 | pass |
| launch, micro exits (TP 3% / SL 3%, hold ≤6) | −0.343768 | 704 | 323 | 352 | 36 | 0.0366 | pass |
| **launch, strict rug filter (WINNER)** — creator buy ≤0.2 SOL, creator never sold, ≤2 early buyers, run-up ≤20%, net flow ≥0.05 SOL, real SOL ≥1, TP 4% / SL 4%, hold ≤20, ≤3 pyramid adds of 0.05 SOL | **−0.080538** | **302** | **77** | **149** | **13** | **0.0081** | **pass** |

Winner detail: without failed txs −0.079998 SOL; at 2× fees −0.160457 SOL;
top-3 coins contribute +0.009475 SOL (net ex-top-3 −0.090013 SOL); 0 rejected
orders; 6 failed txs. Buy-size audit (instrumented run): 77 buy-mints, total
bought 1.810532 SOL, **77/77 coins with total buy ≥0.01 SOL** (min 0.0100,
median 0.0140, max 0.1500) — the guardrail's 20-coin bar is cleared with margin.
Max drawdown 0.81% is the lowest of every strategy tested.

## Why launch-strict won

1. It is the only variant that trades where the data shows an edge: the first few
   slots after creation. Breakout, dip and surge all buy into moves that, on
   average, have already decayed by the time the bot can act (2-slot latency).
2. The strict rug filter is what moves it from −0.39 to −0.08: unfiltered launch
   buys 323 coins and bleeds on bundled/dumped launches; the filter keeps 77.
3. Small stakes + fast exits cap the damage: worst drawdown 0.81% vs 29–95% for
   breakout and the momentum pilot. The 1%-of-real-reserve buy cap keeps launch
   stakes at 0.01–0.03 SOL, so no single coin can hurt the run.
4. Honest limit: it still loses money on the dev window (−0.08 SOL). No variant
   tested reaches positive PnL — the dev window punishes every strategy, pilots
   included. The winner is the least-bad, tightest, most guardrail-safe entry,
   not a claim of a profitable edge. The final window is unseen data; the
   launch-pop structure (price starts at the curve floor, early inflow predicts
   the pop) is the most portable mechanism found, and the strict filter + tiny
   stakes + 20-slot exits are what keep it from blowing up if the final window
   behaves worse.

## Excluded: probe-only artifact (−0.068081 SOL)

Runs with `minRqSol` ≥3 and `maxAge` 3 (or 10/20) scored −0.068081 with 57 coins
and 120 trips — slightly better than the winner. That number is **not** a
strategy: at those settings no main entry can ever fire (a coin essentially never
holds ≥3 SOL of real reserves inside its first 3 slots), so the entire result is
the guardrail probe engine trading 0.01 SOL round trips on its own. It was
excluded as degenerate, not selected.

## Determinism (local, dev dataset, shipped `LAUNCH_PARAMS`)

Two full runs of the shipped configuration, every order dumped per batch:

- Run 1: net −0.080538 SOL, 302 fills, 77 coins, 149 trips, dd 0.0081,
  action log 63,369 lines,
  sha256 `29897e0b53703e176f29aded65a27a09c9e6cc83e150fd9bcdd30f89cde3bb2e`
- Run 2: identical numbers, identical sha256,
  `cmp` on the two action logs: **byte-identical**.

Stdio smoke test of the real `main.ts` (synthetic hello + 3 batches + done):
exit 0, one reply per batch echoing its seq, a 0.025 SOL buy emitted on the
launch batch (exactly the 1% cap on 2.5 SOL of real reserves), `done` summary on
stderr. No `Date.now()`, no `Math.random()`, no environment reads anywhere in
the shipped code.
