"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HOUSE_EDGE_BPS,
  MIN_MULTIPLIER_BPS,
  bandLimits,
  quote,
  type MarketDef,
} from "@xorr/sdk";

/**
 * Band state, held as half-widths in 1e4-scaled bps of spot rather than absolute
 * prices, so the band tracks the market instead of drifting out from under the player
 * while they are deciding.
 */
export interface Band {
  lowHalf1e4: bigint;
  highHalf1e4: bigint;
}

const ONE = 100_000_000n; // 1e4-scaled bps in a whole unit

/**
 * @param markTick1e8 Finest step the settling mark can move, in 8dp units. Zero means
 *        the market is not priced from a venue with a grid, and edges are left alone.
 */
export function useBand(market: MarketDef, tier: number, spot: bigint, markTick1e8 = 0n) {
  const round = market.rounds[tier];
  const ready = spot > 0n;

  /**
   * The legal window depends on spot, because the width is solved against the same
   * integer arithmetic the market prices with.
   *
   * Two things this must not do. It must not solve while spot is still zero — the
   * bisection has nothing to bracket and runs to its upper bound, which is a band
   * covering every price in existence and a multiplier under 1.00x. And it must not be
   * memoised on a key that collapses: keying on `spot / 1e8` made the loading state and
   * a market priced at three cents indistinguishable, so a market like MON kept the
   * garbage window forever. Key on spot itself; the solve is a handful of table lookups.
   */
  const limits = useMemo(() => {
    if (!ready) return null;
    return bandLimits(
      round.probTable,
      spot,
      round.sigma1e4,
      HOUSE_EDGE_BPS,
      MIN_MULTIPLIER_BPS,
      round.minProb1e6,
    );
  }, [round, spot, ready]);

  const [band, setBand] = useState<Band | null>(null);

  /**
   * Re-centre only when the market or the round changes. The legal window shifts by a
   * unit or two as the price moves, and resetting on that would tug the band out from
   * under a player mid-drag.
   */
  useEffect(() => {
    setBand(null);
  }, [market.key, tier]);

  useEffect(() => {
    if (!limits || band !== null) return;
    const mid = (limits.minHalfWidth1e4 + limits.maxHalfWidth1e4) / 2n;
    setBand({ lowHalf1e4: mid, highHalf1e4: mid });
  }, [limits, band]);

  const clamp = useCallback(
    (v: bigint) => {
      if (!limits) return v;
      if (v < limits.minHalfWidth1e4) return limits.minHalfWidth1e4;
      if (v > limits.maxHalfWidth1e4) return limits.maxHalfWidth1e4;
      return v;
    },
    [limits],
  );

  // Always read the band back through the current window, so a window that moved under
  // a resting band can never leave it outside what the market will sell.
  const effective: Band | null =
    band && limits
      ? { lowHalf1e4: clamp(band.lowHalf1e4), highHalf1e4: clamp(band.highHalf1e4) }
      : null;

  /**
   * Snap the edges OUTWARD onto the grid the mark can actually land on.
   *
   * An edge sitting between two prices the venue can print is not a real boundary — the
   * mark will step straight over it — so the band's true width is whatever the grid
   * rounds it to. Better to show that width than a finer one that is not real.
   *
   * Outward on both sides, never inward: rounding a band tighter than the player painted
   * would take away width they chose, and would do it invisibly.
   */
  const snapDown = (v: bigint) =>
    markTick1e8 > 0n && v > 0n ? (v / markTick1e8) * markTick1e8 : v;
  const snapUp = (v: bigint) =>
    markTick1e8 > 0n && v > 0n
      ? ((v + markTick1e8 - 1n) / markTick1e8) * markTick1e8
      : v;

  const low = effective && ready ? snapDown(spot - (spot * effective.lowHalf1e4) / ONE) : 0n;
  const high = effective && ready ? snapUp(spot + (spot * effective.highHalf1e4) / ONE) : 0n;

  const q = useMemo(() => {
    if (!ready || !effective || low <= 0n || high <= low) return null;
    try {
      return quote(round.probTable, spot, low, high, round.sigma1e4, HOUSE_EDGE_BPS);
    } catch {
      return null;
    }
  }, [round, spot, low, high, ready, effective]);

  const capped = q ? q.multiplierBps > round.maxMultiplierBps : false;
  const multiplierBps = q
    ? q.multiplierBps > round.maxMultiplierBps
      ? round.maxMultiplierBps
      : q.multiplierBps
    : 0n;

  /** Widen or tighten both edges together, as the [ and ] keys do. */
  const nudge = useCallback(
    (deltaPct: number) => {
      setBand((b) => {
        if (!b) return b;
        const f = BigInt(Math.round((1 + deltaPct) * 1000));
        return {
          lowHalf1e4: clamp((b.lowHalf1e4 * f) / 1000n),
          highHalf1e4: clamp((b.highHalf1e4 * f) / 1000n),
        };
      });
    },
    [clamp],
  );

  /**
   * Restore a whole band shape, clamped to what the market will currently accept.
   *
   * "The same band again" is not the same numbers again — the limits move with sigma
   * and with the round, so a shape that was legal a minute ago can be outside them now.
   * Clamping means the button always produces a band the market will take, which is the
   * point of it; silently producing a rejected one would be worse than not offering it.
   */
  const setShape = useCallback(
    (shape: { lowHalf1e4: bigint; highHalf1e4: bigint }) => {
      setBand({
        lowHalf1e4: clamp(shape.lowHalf1e4),
        highHalf1e4: clamp(shape.highHalf1e4),
      });
    },
    [clamp],
  );

  const setEdge = useCallback(
    (side: "low" | "high", half1e4: bigint) => {
      setBand((b) =>
        b
          ? { ...b, [side === "low" ? "lowHalf1e4" : "highHalf1e4"]: clamp(half1e4) }
          : b,
      );
    },
    [clamp],
  );

  return {
    band: effective,
    setBand,
    setShape,
    setEdge,
    nudge,
    limits,
    low,
    high,
    multiplierBps,
    prob1e6: q?.prob1e6 ?? 0n,
    capped,
    /** False until a real price has produced a legal band. */
    ready: Boolean(effective) && ready,
  };
}
