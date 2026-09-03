"use client";

import { useEffect, useState } from "react";

/**
 * The finest step the mark for a book-priced market can actually move, in 8dp units.
 *
 * Kuru quotes on a tick grid, so bid and ask are always multiples of the tick — but the
 * mark is their midpoint, which lands on a HALF-tick grid. Rounding a band edge to a
 * full tick would therefore be wrong in the strict direction: it would refuse edges the
 * market can genuinely settle on.
 *
 * Returns 0 for markets that are not priced from a book. BTC and ETH settle on measured
 * exchange tape, which has no venue tick to align to, and inventing one would be a
 * constraint with nothing behind it.
 */
export function useMarkTick(marketKey: string): bigint {
  const [tick1e8, setTick1e8] = useState(0n);

  useEffect(() => {
    if (marketKey !== "MON") {
      setTick1e8(0n);
      return;
    }
    let stop = false;
    void (async () => {
      try {
        const r = await fetch("/api/kuru", { cache: "no-store" });
        const j = (await r.json()) as { params?: { tickSize?: number } };
        const tick = j.params?.tickSize;
        if (stop || !tick || !Number.isFinite(tick) || tick <= 0) return;
        // Half the venue's tick, because the mark is a midpoint of two tick multiples.
        const half = Math.round(tick * 1e8) / 2;
        setTick1e8(BigInt(Math.max(1, Math.round(half))));
      } catch {
        // No alignment is a safe default: the band simply is not snapped.
      }
    })();
    return () => {
      stop = true;
    };
  }, [marketKey]);

  return tick1e8;
}
