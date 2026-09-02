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

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/kuru", { cache: "no-store" });
        const j = (await r.json()) as Strip;
        if (!stop) setS(j);
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
        <span className="text-green">{b.bid.toFixed(6)}</span>
        <span className="text-dim">/</span>
        <span className="text-red">{b.ask.toFixed(6)}</span>
        <span className="text-amber">{b.spreadBps}bps</span>
      </span>
    </button>
  );
}
