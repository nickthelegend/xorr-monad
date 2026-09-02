import { NextResponse } from "next/server";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { KuruOracleAbi } from "@xorr/sdk";

/**
 * Kuru's order book, as XORR reads it.
 *
 * The depth and the top of book come from the chain, through XORR's own KuruOracle —
 * the same call path that prices and settles the market. That matters: an order-book
 * panel fed from a REST endpoint would be a picture of a book, while this is the book
 * the contract itself is looking at, at a block number you can check.
 *
 * The venue statistics alongside it (volume, trade count, unique traders) come from
 * Kuru's public API, because they are aggregates no single contract call can produce.
 * They are labelled as such and are never used for pricing.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const KURU_ORACLE = process.env.NEXT_PUBLIC_KURU_ORACLE as Address | undefined;
const KURU_BOOK = process.env.NEXT_PUBLIC_KURU_BOOK as Address | undefined;

/** keccak256("MON-USD") — the market XORR prices from the book. */
const MON_ID = "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62" as Hex;

/** Kuru's own precisions for this market, read once from getMarketParams. */
const PRICE_PRECISION = 100_000_000; // 1e8
const SIZE_PRECISION = 10_000_000_000; // 1e10

interface Level {
  price: number;
  size: number;
}

/**
 * How healthy is this book, and can a market settle on it?
 *
 * A price feed fails by going silent. An order book fails by going thin — and a thin
 * book still returns a number, which is the dangerous part. These are the conditions
 * worth naming rather than averaging away.
 */
function assess(
  bid: number,
  ask: number,
  bids: Level[],
  asks: Level[],
  venue: { trades24h?: number | null; volume1h?: number | null } | null,
) {
  if (!bid || !ask) {
    return { health: "one-sided" as const, tradeable: false, reason: "one side of the book is empty" };
  }
  if (ask < bid) {
    return { health: "crossed" as const, tradeable: false, reason: "book is crossed mid-update" };
  }
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const depthNear = [...bids, ...asks]
    .filter((l) => Math.abs(l.price - mid) / mid < 0.01)
    .reduce((a, l) => a + l.size, 0);

  if (spreadBps > 500) {
    return {
      health: "wide" as const,
      tradeable: false,
      reason: `spread is ${spreadBps.toFixed(0)} bps — the midpoint is not a price anyone quoted`,
    };
  }
  if (depthNear < 100) {
    return {
      health: "thin" as const,
      tradeable: false,
      reason: `only ${depthNear.toFixed(0)} within 1% of the mid`,
    };
  }

  /**
   * A deep book is not the same as a live one.
   *
   * Resting orders can sit untouched for hours: the spread stays tight, the depth
   * looks healthy, and the midpoint never moves. That is fine for a spot quote and
   * useless for a three-second range — if the price cannot move inside the round,
   * every band that contains the mid wins, and the market is a free option on the
   * house. Depth answers "could I trade here". Recent flow answers "does this price
   * change", and only the second one makes a short-dated market meaningful.
   */
  if (venue && (venue.volume1h ?? 0) === 0) {
    return {
      health: "resting" as const,
      tradeable: false,
      reason: "book is deep but has not traded in an hour — a short round on it cannot move",
    };
  }
  if (venue && (venue.trades24h ?? 0) < 100) {
    return {
      health: "quiet" as const,
      tradeable: false,
      reason: `${venue.trades24h ?? 0} trades in 24h — too infrequent to settle a short round on`,
    };
  }

  return { health: "tight" as const, tradeable: true, reason: "" };
}

async function venueStats(market: string) {
  try {
    const r = await fetch(`https://api.kuru.io/api/v1/markets/${market}`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: Record<string, unknown> };
    const d = j.data;
    if (!d) return null;
    const num = (k: string) => {
      const v = Number(d[k]);
      return Number.isFinite(v) ? v : null;
    };
    return {
      lastPrice: num("lastPrice"),
      lastTradeTime: (d.lastTradeTime as string) ?? null,
      volume24h: num("volume24h"),
      trades24h: (num("buyCount24h") ?? 0) + (num("sellCount24h") ?? 0),
      traders24h: num("uniqueTraders24h"),
      volume1h: num("volume1h"),
      tickSize: num("ticksize"),
      base: (d.basetoken as { ticker?: string })?.ticker ?? null,
      quote: (d.quotetoken as { ticker?: string })?.ticker ?? null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  if (!KURU_ORACLE || !KURU_BOOK) {
    return NextResponse.json(
      { configured: false, reason: "no Kuru oracle deployed for this environment" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC) });

  try {
    const [top, depth, marks, stats] = await Promise.all([
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "quoteTop",
        args: [MON_ID],
      }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "depth",
        args: [MON_ID, 8],
      }) as Promise<readonly [bigint, readonly bigint[], readonly bigint[], readonly bigint[], readonly bigint[]]>,
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "marks",
        args: [MON_ID],
      }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
      venueStats(KURU_BOOK),
    ]);

    const [bid8, ask8, mid8, spreadBps] = top;
    const [bookBlock, bidPx, bidSz, askPx, askSz] = depth;

    const toLevels = (px: readonly bigint[], sz: readonly bigint[]): Level[] =>
      px
        .map((p, i) => ({
          price: Number(p) / PRICE_PRECISION,
          size: Number(sz[i] ?? 0n) / SIZE_PRECISION,
        }))
        .filter((l) => l.price > 0);

    const bids = toLevels(bidPx, bidSz);
    const asks = toLevels(askPx, askSz);
    const bid = Number(bid8) / 1e8;
    const ask = Number(ask8) / 1e8;

    return NextResponse.json(
      {
        configured: true,
        chainId: CHAIN_ID,
        market: KURU_BOOK,
        oracle: KURU_ORACLE,
        // Everything under `onchain` came from a contract call, at this block.
        onchain: {
          block: bookBlock.toString(),
          bid,
          ask,
          mid: Number(mid8) / 1e8,
          spreadBps: Number(spreadBps),
          bids,
          asks,
          // Both marks, so the bias in a plain midpoint is visible rather than assumed.
          marks: {
            mid: Number(marks[0]) / 1e8,
            micro: Number(marks[1]) / 1e8,
            topBidSize: Number(marks[2]) / SIZE_PRECISION,
            topAskSize: Number(marks[3]) / SIZE_PRECISION,
          },
        },
        ...assess(bid, ask, bids, asks, stats),
        // Aggregates the chain cannot produce. Never used for pricing.
        venue: stats,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: (e as Error).message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
