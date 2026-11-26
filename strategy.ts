// Ridge Runner — three rule-based variants for the pump.fun bonding-curve replay.
//
// One shared engine, three different entry ideas, all pure functions of the batches the
// harness sends (no clock, no randomness, insertion-ordered maps only, so the two graded
// executions produce byte-identical action logs).
//
//   breakout — buy a fresh break above the recent high on accelerating inflow, then pyramid
//              into strength; ride the rare runner, cut the false break fast.
//   dip      — buy a 20-50% pullback from the recent high on a liquid curve once buyers are
//              stepping back in; one tranche, quick take-profit, tight stop.
//   surge    — buy a sharp short-window surge (15%+ in 40 slots) with strong inflow and many
//              distinct buyers; scalp it with a fast take-profit and a short hold.
//
// Shared facts of this market that shape every variant:
//   - A buy pays ~1.25% curve fee and a sell pays ~1.25%, plus 105,000 lamports of tx fee
//     per order, so a round trip costs roughly 2.5% + 0.00021 SOL: small stakes must move
//     several percent just to break even, and tiny probe trades are always losers.
//   - Buys in one reply on one coin are capped at 1% of its real SOL reserve, so size is
//     built across batches, never in one shot.
//   - Most curves die near zero; a few run toward completion (~85 SOL real). Entries must
//     therefore be small, exits disciplined, and no position may be held open-ended.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export type Variant = 'breakout' | 'dip' | 'surge' | 'launch';

export interface Params {
  variant: Variant;
  /** Slots since the CreateEvent before an entry is allowed; 0 = any age. */
  minAge: number;
  /** Oldest age (slots) at which a first buy may still be decided; 0 = no limit. */
  maxAge: number;
  /** Real SOL reserve window at decision time. */
  minRqSol: number;
  maxRqSol: number;
  /** Breakout: lookback (slots) whose high the price must clear. */
  breakWindow: number;
  /** Breakout: price must exceed that high by at least this fraction. */
  breakPct: number;
  /** Breakout: price now over price at the window start, at most this (avoid chasing). */
  maxRunup: number;
  /** Dip: lookback (slots) for the recent high the pullback is measured from. */
  dipWindow: number;
  /** Dip: enter when the price is at least this far below the recent high... */
  dipMin: number;
  /** ...and not further than this (a collapse, not a dip). */
  dipMax: number;
  /** Dip: the price must already have bounced at least this far above the window low. */
  dipBounce: number;
  /** Surge: lookback (slots) for the sharp rise. */
  surgeWindow: number;
  /** Surge: price must have risen at least this much over the window. */
  surgePct: number;
  /** Launch: the creator's own buys in the create slot, at most this (SOL). */
  maxDevBuySol: number;
  /** Launch: distinct non-creator buyers at entry, at most this (avoid bundled launches). */
  maxLaunchBuyers: number;
  /** Launch: the largest single non-creator buyer must have bought at least this (SOL) in the flow window; 0 = off. */
  minTopBuyerSol: number;
  /** Flow filter window (slots) shared by all variants. */
  flowWindow: number;
  /** Net SOL bought minus sold over the flow window, at least this. */
  minNetSol: number;
  /** Buy trades over the flow window, at least this many. */
  minBuys: number;
  /** Distinct buying wallets over the flow window, at least this many. */
  minBuyers: number;
  /** First buy of a position (SOL). */
  firstSol: number;
  /** Each pyramid add (SOL). */
  addSol: number;
  /** Most SOL into one position in total. */
  maxSol: number;
  /** Add only once the price is this much above the last buy's decision price. */
  addStep: number;
  /** Most pyramid adds per position. */
  maxAdds: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exits: take profit / stop loss as a fraction of cost. */
  tp: number;
  sl: number;
  /** Trailing stop: arms once value reached cost * (1 + trailArm), then exits on a fall of trail from the peak. */
  trail: number;
  trailArm: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** While the curve's real SOL is at least this, skip the take-profit and time exits (ride a proven runner on the trailing stop); 0 = off. */
  rideRqSol: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most main positions open at once (the rest of caps.max_open_positions is for probes). */
  maxMain: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /**
   * Guardrail pacing: the run must end with at least 20 coins carrying a round trip of
   * 0.01 SOL or more. When the bot's own fills or coins lag targetFills / targetCoins
   * scaled by the share of paceSecs elapsed (block time since the first batch), it opens
   * tiny probe round trips (buy probeSol, sell it all as soon as the buy lands).
   */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const BREAKOUT_PARAMS: Params = {
  variant: 'breakout',
  minAge: 300,
  maxAge: 0,
  minRqSol: 3,
  maxRqSol: 60,
  breakWindow: 200,
  breakPct: 0.02,
  maxRunup: 3,
  dipWindow: 1000,
  dipMin: 0.2,
  dipMax: 0.5,
  dipBounce: 0,
  surgeWindow: 40,
  surgePct: 0.15,
  maxDevBuySol: 1,
  maxLaunchBuyers: 5,
  minTopBuyerSol: 0,
  flowWindow: 50,
  minNetSol: 0.3,
  minBuys: 3,
  minBuyers: 5,
  firstSol: 0.15,
  addSol: 0.15,
  maxSol: 0.6,
  addStep: 0.1,
  maxAdds: 3,
  minBuySol: 0.01,
  buySlipBps: 2000,
  tp: 0.5,
  sl: 0.12,
  trail: 0.25,
  trailArm: 0.2,
  maxHold: 1200,
  rideRqSol: 0,
  cooldown: 150,
  maxEntries: 2,
  maxMain: 5,
  maxExposureSol: 8,
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 21600,
  probeSol: 0.01,
  maxProbes: 1,
};

export const DIP_PARAMS: Params = {
  variant: 'dip',
  minAge: 500,
  maxAge: 0,
  minRqSol: 10,
  maxRqSol: 80,
  breakWindow: 200,
  breakPct: 0.02,
  maxRunup: 3,
  dipWindow: 1000,
  dipMin: 0.2,
  dipMax: 0.5,
  dipBounce: 0.03,
  surgeWindow: 40,
  surgePct: 0.15,
  maxDevBuySol: 1,
  maxLaunchBuyers: 5,
  minTopBuyerSol: 0,
  flowWindow: 30,
  minNetSol: 0,
  minBuys: 3,
  minBuyers: 4,
  firstSol: 0.2,
  addSol: 0,
  maxSol: 0.2,
  addStep: 0,
  maxAdds: 0,
  minBuySol: 0.01,
  buySlipBps: 2000,
  tp: 0.18,
  sl: 0.1,
  trail: 0.15,
  trailArm: 0.12,
  maxHold: 500,
  rideRqSol: 0,
  cooldown: 200,
  maxEntries: 2,
  maxMain: 5,
  maxExposureSol: 8,
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 21600,
  probeSol: 0.01,
  maxProbes: 1,
};

export const SURGE_PARAMS: Params = {
  variant: 'surge',
  minAge: 100,
  maxAge: 1500,
  minRqSol: 2,
  maxRqSol: 40,
  breakWindow: 200,
  breakPct: 0.02,
  maxRunup: 3,
  dipWindow: 1000,
  dipMin: 0.2,
  dipMax: 0.5,
  dipBounce: 0,
  surgeWindow: 40,
  surgePct: 0.15,
  maxDevBuySol: 1,
  maxLaunchBuyers: 5,
  minTopBuyerSol: 0,
  flowWindow: 40,
  minNetSol: 0.5,
  minBuys: 4,
  minBuyers: 6,
  firstSol: 0.1,
  addSol: 0,
  maxSol: 0.1,
  addStep: 0,
  maxAdds: 0,
  minBuySol: 0.01,
  buySlipBps: 2000,
  tp: 0.2,
  sl: 0.08,
  trail: 0.12,
  trailArm: 0.1,
  maxHold: 250,
  rideRqSol: 0,
  cooldown: 100,
  maxEntries: 2,
  maxMain: 5,
  maxExposureSol: 8,
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 21600,
  probeSol: 0.01,
  maxProbes: 1,
};


export const LAUNCH_PARAMS: Params = {
  variant: 'launch',
  minAge: 0,
  maxAge: 3,
  minRqSol: 1,
  maxRqSol: 30,
  breakWindow: 200,
  breakPct: 0.02,
  maxRunup: 1.2,
  dipWindow: 1000,
  dipMin: 0.2,
  dipMax: 0.5,
  dipBounce: 0,
  surgeWindow: 40,
  surgePct: 0.15,
  maxDevBuySol: 0.2,
  maxLaunchBuyers: 2,
  minTopBuyerSol: 0,
  flowWindow: 5,
  minNetSol: 0.05,
  minBuys: 1,
  minBuyers: 1,
  firstSol: 0.1,
  addSol: 0.05,
  maxSol: 0.2,
  addStep: 0.05,
  maxAdds: 3,
  minBuySol: 0.005,
  buySlipBps: 10000,
  tp: 0.04,
  sl: 0.04,
  trail: 0,
  trailArm: 1,
  maxHold: 20,
  rideRqSol: 0,
  cooldown: 50,
  maxEntries: 1,
  maxMain: 5,
  maxExposureSol: 8,
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 21600,
  probeSol: 0.01,
  maxProbes: 1,
};

export const DEFAULT_PARAMS: Params = BREAKOUT_PARAMS;

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  price: number;
  buy: boolean;
  sol: number;
  user: string;
}

interface Tape {
  created: number | null;
  creator: string | null;
  /** Price (vq/vt) at the CreateEvent. */
  p0: number;
  /** SOL the creator bought in the create slot. */
  devBuy: number;
  /** The creator has sold at least once. */
  devSold: boolean;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  lastAddPrice: number;
  adds: number;
  lastValue: number;
}

export function createStrategy(p: Params): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = Math.max(p.breakWindow, p.dipWindow, p.surgeWindow, p.flowWindow) + 10;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: null, p0: 0, devBuy: 0, devSold: false, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Net SOL, buy-trade count and distinct buyers over the last `w` slots. */
  const flowStats = (t: Tape, now: number, w: number): { net: number; buys: number; buyers: number } => {
    let net = 0;
    let buys = 0;
    const byUser = new Set<string>();
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      if (tr.buy) {
        net += tr.sol;
        buys++;
        byUser.add(tr.user);
      } else {
        net -= tr.sol;
      }
    }
    return { net, buys, buyers: byUser.size };
  };

  /** Highest price among trades in (now - w, now); 0 when none. */
  const windowHigh = (t: Tape, now: number, w: number): number => {
    let high = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      if (tr.price > high) high = tr.price;
    }
    return high;
  };

  /** Price of the oldest trade still inside (now - w, now); -1 when none. */
  const windowStartPrice = (t: Tape, now: number, w: number): number => {
    let price = -1;
    for (const tr of t.trades) {
      if (tr.slot <= now - w) continue;
      price = tr.price;
      break;
    }
    return price;
  };

  /** Highest price among trades strictly before this slot; 0 when none. */
  const priorHigh = (t: Tape, now: number, w: number): number => {
    let high = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot >= now) continue;
      if (tr.slot <= now - w) break;
      if (tr.price > high) high = tr.price;
    }
    return high;
  };

  /** Entry signal on a curve's tape at slot `now`. */
  const entrySignal = (t: Tape, now: number, rqSol: number): boolean => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.created === null || now - t.created < p.minAge) return false;
    if (p.maxAge > 0 && now - t.created > p.maxAge) return false;
    const f = flowStats(t, now, p.flowWindow);
    if (f.net < p.minNetSol || f.buys < p.minBuys || f.buyers < p.minBuyers) return false;
    const last = t.trades[t.trades.length - 1];
    if (last === undefined) return false;
    if (p.variant === 'launch') {
      // Buy the launch itself: the creator has not sold, the creator's own buy is small,
      // only a few distinct wallets are in yet, and the price has not already popped.
      if (t.devSold || t.devBuy > p.maxDevBuySol) return false;
      const f = flowStats(t, now, p.flowWindow);
      if (f.buyers > p.maxLaunchBuyers) return false;
      if (p.minTopBuyerSol > 0) {
        let top = 0;
        const byUser = new Map<string, number>();
        for (let i = t.trades.length - 1; i >= 0; i--) {
          const tr = t.trades[i]!;
          if (tr.slot <= now - p.flowWindow) break;
          if (tr.buy && tr.user !== t.creator) {
            const v = (byUser.get(tr.user) ?? 0) + tr.sol;
            byUser.set(tr.user, v);
            if (v > top) top = v;
          }
        }
        if (top < p.minTopBuyerSol) return false;
      }
      if (t.p0 > 0 && last.price / t.p0 > p.maxRunup) return false;
      return true;
    }
    if (p.variant === 'breakout') {
      const high = priorHigh(t, now, p.breakWindow);
      if (high <= 0 || last.price < high * (1 + p.breakPct)) return false;
      const start = windowStartPrice(t, now, p.breakWindow);
      if (start > 0 && last.price / start > p.maxRunup) return false;
      return true;
    }
    if (p.variant === 'dip') {
      const high = windowHigh(t, now, p.dipWindow);
      if (high <= 0) return false;
      const dd = 1 - last.price / high;
      if (dd < p.dipMin || dd > p.dipMax) return false;
      // Bounce confirmation: the price must already be recovering from the window low.
      if (p.dipBounce > 0) {
        let low = Infinity;
        for (let i = t.trades.length - 1; i >= 0; i--) {
          const tr = t.trades[i]!;
          if (tr.slot <= now - p.dipWindow) break;
          if (tr.price < low) low = tr.price;
        }
        if (low === Infinity || last.price < low * (1 + p.dipBounce)) return false;
      }
      // Stabilising: no new low in the last few trades, buyers stepping back in.
      let recentBuys = 0;
      let low = Infinity;
      const n = Math.min(5, t.trades.length);
      for (let i = t.trades.length - n; i < t.trades.length; i++) {
        const tr = t.trades[i]!;
        if (tr.buy) recentBuys++;
        if (tr.price < low) low = tr.price;
      }
      if (recentBuys < 3) return false;
      if (last.price < low) return false;
      return true;
    }
    // surge
    const start = windowStartPrice(t, now, p.surgeWindow);
    if (start <= 0 || last.price / start - 1 < p.surgePct) return false;
    const high = windowHigh(t, now, p.surgeWindow);
    if (high <= 0 || last.price < high * 0.95) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
          t.p0 = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          if (t.creator !== null && e.user === t.creator) {
            if (e.is_buy && e.slot === t.created) t.devBuy += sol;
            if (!e.is_buy) t.devSold = true;
          }
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves) });
          traded.add(e.mint);
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;
      const spentThisBatch = new Map<Pubkey, number>();

      // Exits first, in mint order (deterministic).
      const heldMints = [...held.keys()].sort();
      for (const mint of heldMints) {
        const h = held.get(mint)!;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rqSol = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        const riding = p.rideRqSol > 0 && rqSol >= p.rideRqSol;
        let exit = h.exiting;
        if (!exit && !riding && value >= cost * (1 + p.tp)) exit = true;
        if (!exit && value < cost * (1 - p.sl)) exit = true;
        if (!exit && p.trail > 0 && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && !riding && now - h.opened > p.maxHold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        let sellPending = false;
        for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
        if (sellPending) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of [...probes.entries()].sort()) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries and pyramid adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      const tradedSorted = [...traded].sort();
      for (const mint of tradedSorted) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want = 0;
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (!entrySignal(t, now, rqSol)) continue;
          want = p.firstSol;
        } else {
          // Pyramid into strength only (breakout variant): the price stepped up from the
          // last add, the position is still up, and net SOL still flows in.
          if (p.maxAdds <= 0 || h.exiting || !h.filled || h.adds >= p.maxAdds) continue;
          if (h.invested >= p.maxSol - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (price < h.lastAddPrice * (1 + p.addStep)) continue;
          if (h.lastValue < Number(pos.cost_lamports) / LAMPORTS * 1.02) continue;
          if (flowStats(t, now, p.flowWindow).net < p.minNetSol) continue;
          if (rqSol > p.maxRqSol) continue;
          want = Math.min(p.addSol, p.maxSol - h.invested);
        }
        if (want < p.minBuySol) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        const already = spentThisBatch.get(mint) ?? 0;
        let amount = Math.min(capSol - already, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        spentThisBatch.set(mint, already + amount);
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastAddPrice: price, adds: 0, lastValue: 0 });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
          h.adds++;
        }
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of tradedSorted) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
