"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_MS,
  MARKETS,
  PaperEngine,
  PaperFeed,
  ROUND_BLOCKS,
  type FireResult,
  type MarketDef,
  type PaperTicket,
} from "@xorr/sdk";

export interface PricePoint {
  block: number;
  price: bigint;
}

const HISTORY = 160;

/**
 * Fetch the market's real price and its recent one-second tape.
 *
 * The demo desk starts where the market actually is and then replays real returns —
 * no invented starting marks and no bell curve. That matters for honesty, not
 * realism: the multiplier is priced off a distribution measured on this same tape, so
 * a desk driven by a Gaussian walk quotes one probability and delivers another. If
 * the tape cannot be fetched the desk says so rather than making one up.
 */
async function fetchRealTape(
  marketKey: string,
): Promise<{ price: bigint; returns: number[] }> {
  const r = await fetch(`/api/price?market=${encodeURIComponent(marketKey)}&history=1`, {
    cache: "no-store",
  });
  const j = (await r.json()) as { price?: string; returns?: number[]; error?: string };
  if (!r.ok || !j.price) throw new Error(j.error ?? `price unavailable (${r.status})`);
  if (!j.returns || j.returns.length < 8) throw new Error("no recent tape to replay");
  return { price: BigInt(j.price), returns: j.returns };
}

export interface DeskState {
  /** False until a real price has been fetched for this market. */
  ready: boolean;
  /** Non-null when the real price could not be fetched. */
  priceError: string | null;
  market: MarketDef;
  tier: number;
  spot: bigint;
  history: PricePoint[];
  block: number;
  balance: bigint;
  tickets: PaperTicket[];
  openTickets: PaperTicket[];
  utilisationBps: bigint;
  pnl: bigint;
  lastSettled: PaperTicket | null;
  running: boolean;
}

/**
 * The paper desk. Runs the SDK's PaperEngine — which enforces the same rules the
 * contract does — against a price walk calibrated to the same measured volatility the
 * market prices with, one step every 300ms because that is one Monad block.
 */
export function usePaperDesk(initialMarketKey = "BTC") {
  const [marketKey, setMarketKey] = useState(initialMarketKey);
  const [tier, setTier] = useState(2); // 100 blocks, ~30s
  const [running, setRunning] = useState(true);
  const [, forceRender] = useState(0);

  const market = useMemo(
    () => MARKETS.find((m) => m.key === marketKey) ?? MARKETS[0],
    [marketKey],
  );

  const engineRef = useRef<PaperEngine | null>(null);
  const feedRef = useRef<PaperFeed | null>(null);
  const historyRef = useRef<PricePoint[]>([]);
  const lastSettledRef = useRef<PaperTicket | null>(null);
  const [ready, setReady] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  if (!engineRef.current) engineRef.current = new PaperEngine();

  // Rebuild the feed when the market changes; the engine (and balance) persists.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPriceError(null);
    feedRef.current = null;

    void (async () => {
      try {
        const { price: start, returns } = await fetchRealTape(market.key);
        if (cancelled) return;

        // Start somewhere different each session so two desks are not in lockstep.
        const offset = Math.floor(Math.random() * returns.length);
        const feed = new PaperFeed(market, start, returns, offset);

        /**
         * Fill the backlog BACKWARDS, so the desk opens exactly where the market is.
         *
         * A dead-straight trace reads as broken, so the chart needs history — but
         * walking the feed forward to produce it moved the opening price a hundred and
         * sixty replayed seconds away from the real one. The desk then claimed, in the
         * README and in this file, to "start where the market actually is" while
         * opening about fifteen basis points from it.
         *
         * Running the same real returns in reverse from the fetched price gives a
         * backlog that leads up to it instead of away from it: the trace is just as
         * real, and the price on screen when the desk opens is the price the market is
         * at. The feed itself still starts at that price and steps forward from there.
         */
        const seeded: PricePoint[] = [];
        const back: bigint[] = [];
        let p = Number(start);
        for (let i = 1; i <= HISTORY; i++) {
          const r = returns[((offset - i) % returns.length + returns.length) % returns.length];
          p = p / Math.exp(r);
          back.push(BigInt(Math.max(1, Math.round(p))));
        }
        back.reverse();
        const firstBlock = engineRef.current!.block - HISTORY;
        back.forEach((price, i) => seeded.push({ block: firstBlock + i, price }));
        feedRef.current = feed;
        historyRef.current = seeded;
        setReady(true);
        forceRender((n) => n + 1);
      } catch (e) {
        if (!cancelled) setPriceError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [market]);

  // One tick per block.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const engine = engineRef.current!;
      const feed = feedRef.current;
      if (!feed) return; // no real price yet — the clock does not run on nothing

      const price = feed.step();
      const settled = engine.tick(price);
      if (settled.length > 0) lastSettledRef.current = settled[settled.length - 1];

      const h = historyRef.current;
      h.push({ block: engine.block, price });
      if (h.length > HISTORY) h.shift();

      forceRender((n) => n + 1);
    }, BLOCK_MS);
    return () => clearInterval(id);
  }, [running]);

  const engine = engineRef.current!;
  const spot = feedRef.current?.price ?? 0n;

  const fire = useCallback(
    (low: bigint, high: bigint, stake: bigint): FireResult => {
      if (spot === 0n) return { ok: false, error: { kind: "bad-band" } };
      const r = engineRef.current!.fire(market, spot, low, high, stake, tier);
      forceRender((n) => n + 1);
      return r;
    },
    [market, spot, tier],
  );

  const stack = useCallback(
    (parentId: number, stake: bigint): FireResult => {
      if (spot === 0n) return { ok: false, error: { kind: "bad-band" } };
      const r = engineRef.current!.stack(market, parentId, spot, stake);
      forceRender((n) => n + 1);
      return r;
    },
    [market, spot],
  );

  const reset = useCallback(() => {
    engineRef.current = new PaperEngine();
    lastSettledRef.current = null;
    forceRender((n) => n + 1);
  }, []);

  const state: DeskState = {
    ready: ready && feedRef.current !== null,
    priceError,
    market,
    tier,
    spot,
    history: historyRef.current,
    block: engine.block,
    balance: engine.balance,
    tickets: engine.tickets,
    openTickets: engine.openTickets,
    utilisationBps: engine.utilisationBps,
    pnl: engine.pnl,
    lastSettled: lastSettledRef.current,
    running,
  };

  return {
    state,
    engine,
    setMarketKey,
    setTier,
    setRunning,
    fire,
    stack,
    reset,
    roundBlocks: ROUND_BLOCKS,
  };
}
