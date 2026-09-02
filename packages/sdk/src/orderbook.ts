/**
 * Order-book arithmetic.
 *
 * Quoting a trade against a real book means walking it. A single "price" is only the
 * top level, and anything larger than what rests there gets progressively worse fills —
 * which is exactly the number a player needs to see before they swap. Everything here
 * works on the depth read from the chain, so the estimate and the execution are looking
 * at the same orders.
 */

export interface Level {
  /** Price in quote per base. */
  price: number;
  /** Size in base units. */
  size: number;
}

export interface Fill {
  /** Base actually filled. */
  filled: number;
  /** Quote received (selling) or spent (buying). */
  proceeds: number;
  /** Weighted average price across the levels consumed. */
  averagePrice: number;
  /** How far the average sits from the touch, in bps. Always >= 0. */
  slippageBps: number;
  /** Levels the order would eat through. */
  levelsConsumed: number;
  /** True when the book ran out before the order was filled. */
  partial: boolean;
}

const EMPTY: Fill = {
  filled: 0,
  proceeds: 0,
  averagePrice: 0,
  slippageBps: 0,
  levelsConsumed: 0,
  partial: true,
};

/**
 * Sell `size` of the base asset into the bids.
 *
 * @param bids best first, descending in price
 */
export function quoteSell(bids: Level[], size: number): Fill {
  if (size <= 0 || bids.length === 0) return EMPTY;

  const touch = bids[0].price;
  let remaining = size;
  let proceeds = 0;
  let levels = 0;

  for (const level of bids) {
    if (remaining <= 0) break;
    if (level.size <= 0) continue;
    const take = Math.min(remaining, level.size);
    proceeds += take * level.price;
    remaining -= take;
    levels += 1;
  }

  const filled = size - remaining;
  if (filled <= 0) return EMPTY;

  const averagePrice = proceeds / filled;
  // Selling fills at or below the touch, so the average can only be worse.
  const slippageBps = touch > 0 ? Math.max(0, ((touch - averagePrice) / touch) * 10_000) : 0;

  return {
    filled,
    proceeds,
    averagePrice,
    slippageBps,
    levelsConsumed: levels,
    partial: remaining > 1e-12,
  };
}

/**
 * Buy `size` of the base asset from the asks.
 *
 * @param asks best first, ascending in price
 */
export function quoteBuy(asks: Level[], size: number): Fill {
  if (size <= 0 || asks.length === 0) return EMPTY;

  const touch = asks[0].price;
  let remaining = size;
  let cost = 0;
  let levels = 0;

  for (const level of asks) {
    if (remaining <= 0) break;
    if (level.size <= 0) continue;
    const take = Math.min(remaining, level.size);
    cost += take * level.price;
    remaining -= take;
    levels += 1;
  }

  const filled = size - remaining;
  if (filled <= 0) return EMPTY;

  const averagePrice = cost / filled;
  const slippageBps = touch > 0 ? Math.max(0, ((averagePrice - touch) / touch) * 10_000) : 0;

  return {
    filled,
    proceeds: cost,
    averagePrice,
    slippageBps,
    levelsConsumed: levels,
    partial: remaining > 1e-12,
  };
}

/** Total base resting within `bps` of the mid, both sides. A depth-at-a-glance number. */
export function depthWithin(bids: Level[], asks: Level[], bps: number): number {
  const best = bids[0]?.price ?? 0;
  const ask = asks[0]?.price ?? 0;
  if (!best || !ask) return 0;
  const mid = (best + ask) / 2;
  const band = (mid * bps) / 10_000;
  return [...bids, ...asks]
    .filter((l) => Math.abs(l.price - mid) <= band)
    .reduce((a, l) => a + l.size, 0);
}
