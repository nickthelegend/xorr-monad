"use client";

import { useEffect, useState } from "react";

interface Strip {
  configured: boolean;
  onchain?: { bid: number; ask: number; mid: number; spreadBps: number; block: string };
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
export function BookStrip({ onOpen }: { onOpen?: () => void }) {
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
