"use client";

import { useEffect, useState } from "react";

interface Level {
  price: number;
  size: number;
}

interface Strip {
  configured: boolean;
  onchain?: {
    bid: number;
    ask: number;
    mid: number;
    spreadBps: number;
    block: string;
    bids?: Level[];
    asks?: Level[];
  };
  health?: string;
  tradeable?: boolean;
  reason?: string;
}

const TONE: Record<string, string> = {
  tight: "text-green",
  wide: "text-amber",
  thin: "text-amber",
  resting: "text-amber",
  quiet: "text-amber",
  "one-sided": "text-red",
  crossed: "text-red",
};

/**
 * One line of Kuru, on the deck.
 *
 * The order book is the point of this market, so it belongs on the screen rather than
 * two taps away in a sheet. Bid, ask, spread and a one-word verdict is as much as fits
 * without crowding the price — the full ladder lives in the Kuru book sheet.
 */
export function BookStrip({
  onOpen,
  bandHalfBps,
}: {
  onOpen?: () => void;
  /**
   * The painted band's WIDTH, in bps of its own centre — not its absolute prices.
   *
   * The demo desk's MON price starts at the real mark and then walks on replayed BTC
   * returns, so by the time anyone looks it is somewhere the real book is not. Asking
   * "how much rests between these two prices" against a live ladder would then be
   * comparing a simulated band to a real book and reporting the answer as if it meant
   * something. The width is the part that transfers: a band this tight, centred where
   * the book actually is, has this much size behind it.
   */
  bandHalfBps?: number | null;
}) {
  const [s, setS] = useState<Strip | null>(null);
  /**
   * A short history of the spread, kept client-side.
   *
   * The spread is the number that decides whether the oracle will price this book at
   * all, and a single reading cannot tell a book that is steadily 198 bps wide from one
   * that just gapped. Twenty samples is enough to see the difference and short enough
   * that it means "recently" rather than "today". It is not persisted: on reload the
   * question is what the book is doing now.
   */
  const [spreads, setSpreads] = useState<number[]>([]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/kuru", { cache: "no-store" });
        const j = (await r.json()) as Strip;
        if (stop) return;
        setS(j);
        if (j.onchain) {
          setSpreads((prev) => [...prev, j.onchain!.spreadBps].slice(-20));
        }
      } catch {
        // The strip is supplementary; the desk keeps working without it.
        if (!stop) setS(null);
      }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (!s?.configured || !s.onchain) return null;
  const b = s.onchain;

  /**
   * How much size actually rests between the two edges the player painted.
   *
   * The band is drawn on a price axis and the book is a list of resting orders; until
   * you add them up, the two are separate pictures. This is the number that joins them
   * — and on a book this thin it is often small, which is the honest answer and the
   * reason the market refuses some bands outright.
   */
  const inBand =
    bandHalfBps && bandHalfBps > 0 && b.bids && b.asks && b.mid > 0
      ? (() => {
          const half = (b.mid * bandHalfBps) / 10_000;
          return [...b.bids, ...b.asks]
            .filter((l) => l.price >= b.mid - half && l.price <= b.mid + half)
            .reduce((a, l) => a + l.size, 0);
        })()
      : null;
  const tone = TONE[s.health ?? ""] ?? "text-dim";

  return (
    <button
      onClick={onOpen}
      className="mono mt-1 flex w-full items-center justify-between gap-2 rounded-lg bg-[#0b0b0b] px-2 py-1.5 text-[9px] tracking-[0.08em] transition-colors hover:bg-[#111]"
      title="Kuru MON-AUSD, read on-chain"
    >
      <span className="flex items-center gap-1.5">
        <span className="text-dim">KURU</span>
        <span className={tone}>{(s.health ?? "").toUpperCase()}</span>
      </span>
      <span className="tnum flex items-center gap-2">
        {inBand !== null ? (
          /**
           * Zero is the interesting answer, not the empty one.
           *
           * The mark is a midpoint, so it lives in the spread where by definition no
           * orders rest. A band tighter than the half-spread therefore contains none —
           * which tells the player something real about the book they are trading
           * against, and "0" alone does not say it.
           */
          <span
            className={inBand > 0 ? "text-amber" : "text-dim"}
            title={
              inBand > 0
                ? `size resting within ±${((bandHalfBps ?? 0) / 100).toFixed(2)}% of the real mark — a band as tight as yours, centred where the book is`
                : `a band this tight sits entirely inside the ${b.spreadBps} bps spread, where no orders rest`
            }
          >
            {inBand > 0
              ? `${inBand >= 1000 ? `${(inBand / 1000).toFixed(1)}k` : inBand.toFixed(0)} at your width`
              : "inside the spread"}
          </span>
        ) : null}
        {spreads.length > 2 ? <SpreadSpark values={spreads} /> : null}
        <span className="text-green">{b.bid.toFixed(6)}</span>
        <span className="text-dim">/</span>
        <span className="text-red">{b.ask.toFixed(6)}</span>
        <span className="text-amber">{b.spreadBps}bps</span>
      </span>
    </button>
  );
}

/**
 * The spread over the last few reads, as one small shape.
 *
 * Scaled to its own range rather than to zero: the interesting thing is whether this
 * book is widening or steady, and a bar chart anchored at zero renders 198 and 202 as
 * the same height. A flat line here means a stable book, which is information.
 */
function SpreadSpark({ values }: { values: number[] }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const w = 34;
  const h = 9;
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - ((v - lo) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const rising = values[values.length - 1] > values[0];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-label={`Spread over the last ${values.length} reads, ${lo.toFixed(0)} to ${hi.toFixed(0)} bps`}
      className="overflow-visible"
    >
      <path
        d={d}
        fill="none"
        strokeWidth={1}
        className={rising ? "stroke-red" : "stroke-green"}
        strokeLinejoin="round"
      />
    </svg>
  );
}
