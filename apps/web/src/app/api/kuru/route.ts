import { NextResponse } from "next/server";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { IKuruOrderBookAbi, KuruOracleAbi, OracleRouterAbi, costToMoveMark } from "@xorr/sdk";

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
const ROUTER = process.env.NEXT_PUBLIC_ORACLE as Address | undefined;

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
  /**
   * Whether depth could be measured at all.
   *
   * Where the ladder is unavailable — no oracle deployed, so no on-chain decoder for
   * Kuru's packed L2 bytes — an empty ladder means "not measured", not "empty". Scoring
   * it as thin would put a false verdict on a healthy book, which is precisely the kind
   * of plausible-looking wrong answer the rest of this file exists to refuse.
   */
  depthKnown = true,
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
  if (depthKnown && depthNear < 100) {
    return {
      health: "thin" as const,
      tradeable: false,
      reason: `only ${depthNear.toFixed(0)} within 1% of the mid`,
    };
  }
  if (!depthKnown) {
    return {
      health: "unmeasured" as const,
      tradeable: false,
      reason:
        "the touch is real, but depth needs KuruOracle's on-chain decoder and it is not " +
        "deployed here — so how much rests behind this quote is unknown, not zero",
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


/**
 * The same asset on the deepest centralised venue that lists it.
 *
 * MON is not on Binance, but Coinbase quotes MON-USD — so the on-chain book can be put
 * next to an order book with real size and a real spread, which is the only way to say
 * anything meaningful about how wide 198 bps actually is. The basis is reported, not
 * corrected for: nothing here touches pricing, and a market that settles on the book
 * must settle on the book even when a centralised venue disagrees.
 *
 * Failing to reach Coinbase costs the panel one row and nothing else.
 */
async function centralisedQuote() {
  try {
    const r = await fetch("https://api.exchange.coinbase.com/products/MON-USD/ticker", {
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { bid?: string; ask?: string };
    const bid = Number(j.bid);
    const ask = Number(j.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= bid) return null;
    const mid = (bid + ask) / 2;
    return { venue: "coinbase:MON-USD", bid, ask, mid, spreadBps: ((ask - bid) / mid) * 10_000 };
  } catch {
    return null;
  }
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

/**
 * Read Kuru's book directly, for a deployment that has no XORR oracle of its own.
 *
 * The hosted build has no chain to deploy to, so `KuruOracle` is not in the path there
 * — but Kuru's market is, on Monad mainnet, and refusing to show it would be a worse
 * answer than showing it and saying what is missing. This calls the venue's own
 * contract with exactly the same reads the oracle performs, and the response carries
 * `via: "book"` so the panel can state plainly that the guards live in a contract that
 * is not deployed here rather than implying they are running.
 *
 * It is deliberately NOT a fallback for a failed oracle read. It is only used where no
 * oracle address is configured at all. A deployment that has an oracle and cannot reach
 * it reports the failure.
 */
async function readBookDirect(pub: ReturnType<typeof createPublicClient>, book: Address) {
  const [top, params, blockNumber] = await Promise.all([
    pub.readContract({
      address: book,
      abi: IKuruOrderBookAbi,
      functionName: "bestBidAsk",
    }) as Promise<readonly [bigint, bigint]>,
    pub.readContract({
      address: book,
      abi: IKuruOrderBookAbi,
      functionName: "getMarketParams",
    }) as Promise<
      readonly [number, bigint, Address, bigint, Address, bigint, number, bigint, bigint, bigint]
    >,
    pub.getBlockNumber(),
  ]);

  // Kuru quotes bestBidAsk with 18 decimals; XORR settles on 8.
  const bid = Number(top[0] / 10_000_000_000n) / 1e8;
  const ask = Number(top[1] / 10_000_000_000n) / 1e8;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  const spreadBps = mid > 0 ? Math.round(((ask - bid) / mid) * 10_000) : 0;

  const pricePrecision = Number(params[0]);
  const sizePrecision = Number(params[1]);

  /**
   * No ladder here, on purpose.
   *
   * `getL2Book` hands back abi-packed words, which is why KuruOracle carries an
   * on-chain decoder — and decoding them a second time in TypeScript would be exactly
   * the duplicated implementation this repo diffs 1,728 quotes to avoid. Where the
   * oracle is not deployed, the panel shows the touch and the venue's own rules, and
   * says the ladder needs the decoder.
   */
  return {
    blockNumber,
    bid,
    ask,
    mid,
    spreadBps,
    params: {
      tickSize: Number(params[6]) / pricePrecision,
      minSize: Number(params[7]) / sizePrecision,
      maxSize: Number(params[8]) / sizePrecision,
      takerFeeBps: Number(params[9]),
    },
  };
}


/**
 * Which oracle the market is actually routed to right now.
 *
 * `OracleRouter` can fall back from the book to the push feed, and a fallback that
 * happens quietly is worse than one that fails: the console would go on saying the
 * price is an order book while it had become a relayed feed. Ask the router rather than
 * assuming, and let the panel state what came back.
 *
 * bytes8 label, ascii, right-padded with zeros — "kuru", "keeper", "chainlink".
 */
async function routedSource(pub: ReturnType<typeof createPublicClient>, router: Address) {
  const [source, label] = (await pub.readContract({
    address: router,
    abi: OracleRouterAbi,
    functionName: "sourceOf",
    args: [MON_ID],
  })) as readonly [Address, Hex];

  const text = (label.slice(2).match(/.{2}/g) ?? [])
    .map((b) => String.fromCharCode(parseInt(b, 16)))
    .join("")
    .replace(/\0+$/, "");
  return { source, label: text };
}

export async function GET(req: Request) {
  if (!KURU_BOOK) {
    return NextResponse.json(
      { configured: false, reason: "no Kuru market configured for this environment" },
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

  /**
   * Read the book as it was at a past block.
   *
   * The ladder is a contract call, so "what did this book look like then" is the same
   * call with a block tag — no snapshot to store, no archive of our own to trust. That
   * is worth more than persisting a copy at open time would be: a stored snapshot is
   * something we asserted, and this is something anyone can re-derive.
   */
  const atParam = new URL(req.url).searchParams.get("block");
  const atBlock = atParam && /^\d+$/.test(atParam) ? BigInt(atParam) : undefined;

  /**
   * No oracle deployed here — read the venue directly and say so.
   *
   * This is the hosted build's situation: there is a real Kuru market on Monad mainnet
   * and no chain to deploy XORR's oracle to. Showing the real book while stating that
   * the guards are not in the path is better than showing nothing, and much better than
   * showing it as though the oracle produced it.
   */
  if (!KURU_ORACLE) {
    try {
      const direct = await readBookDirect(pub, KURU_BOOK);
      const stats = await venueStats(KURU_BOOK);
      return NextResponse.json(
        {
          configured: true,
          via: "book",
          chainId: CHAIN_ID,
          market: KURU_BOOK,
          onchain: {
            block: direct.blockNumber.toString(),
            bid: direct.bid,
            ask: direct.ask,
            mid: direct.mid,
            spreadBps: direct.spreadBps,
            bids: [],
            asks: [],
          },
          params: direct.params,
          ...assess(direct.bid, direct.ask, [], [], stats, false),
          venue: stats,
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (e) {
      return NextResponse.json(
        { configured: true, via: "book", error: (e as Error).message },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
  }

  try {
    const [top, depth, marks, params, cfg, stats] = await Promise.all([
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "quoteTop",
        ...(atBlock ? { blockNumber: atBlock } : {}),
        args: [MON_ID],
      }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "depth",
        ...(atBlock ? { blockNumber: atBlock } : {}),
        args: [MON_ID, 8],
      }) as Promise<readonly [bigint, readonly bigint[], readonly bigint[], readonly bigint[], readonly bigint[]]>,
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "marks",
        ...(atBlock ? { blockNumber: atBlock } : {}),
        args: [MON_ID],
      }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "marketParams",
        ...(atBlock ? { blockNumber: atBlock } : {}),
        args: [MON_ID],
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>,
      // How this book is configured to produce a mark, so the panel can name the rule
      // the contract is actually applying rather than assume one.
      pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "books",
        args: [MON_ID],
      }) as Promise<
        readonly [Address, number, number, bigint, number, number, boolean, number]
      >,
      venueStats(KURU_BOOK),
    ]);

    /**
     * A router that is not pointing at this oracle is the interesting case, and it must
     * not stop the panel rendering — so it is read separately and allowed to fail.
     */
    const cex = await centralisedQuote();

    let routed: { source: Address; label: string } | null = null;
    if (ROUTER) {
      try {
        routed = await routedSource(pub, ROUTER);
      } catch {
        routed = null;
      }
    }

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

    /**
     * Which rule produced the mark, and whether it was allowed to run.
     *
     * The oracle can be set to weight the mark by resting size, but it refuses to do so
     * off a side that is dust — one twentieth of the depth floor is the threshold, and
     * below it the mark falls back to the plain midpoint. Both facts have to reach the
     * panel: a reader looking at a microprice book that currently equals the midpoint
     * should be told the guard is why, not left to infer the market is priced on the
     * midpoint by design.
     */
    const [, , , minDepth, , markEnum, , twapWindow] = cfg;
    const twapWindowRaw = twapWindow;

    /**
     * Did the touch move across the settlement window?
     *
     * The averaged mark's whole argument is that one block cannot move it. The honest
     * companion to that claim is showing when the book DID move over the window — a
     * settlement taken across a genuine move is a different thing from one taken across
     * a still book, and only one of them is worth arguing about.
     *
     * Read at the block the window started, with the same call. Failing is not fatal:
     * a node without that block's state simply means the comparison is unavailable.
     */
    let windowMove: { fromBid: number; fromAsk: number; movedBps: number; blocks: number } | null =
      null;
    const windowBlocks = Math.round((Number(twapWindowRaw) * 1000) / 300);
    if (windowBlocks > 0 && bookBlock > BigInt(windowBlocks)) {
      try {
        const then = (await pub.readContract({
          address: KURU_ORACLE,
          abi: KuruOracleAbi,
          functionName: "quoteTop",
          blockNumber: bookBlock - BigInt(windowBlocks),
          args: [MON_ID],
        })) as readonly [bigint, bigint, bigint, bigint];
        const thenMid = Number(then[2]) / 1e8;
        const nowMid = Number(mid8) / 1e8;
        if (thenMid > 0) {
          windowMove = {
            fromBid: Number(then[0]) / 1e8,
            fromAsk: Number(then[1]) / 1e8,
            movedBps: ((nowMid - thenMid) / thenMid) * 10_000,
            blocks: windowBlocks,
          };
        }
      } catch {
        windowMove = null;
      }
    }

    const mark = markEnum === 1 ? ("MICRO" as const) : ("MID" as const);
    const dustFloorRaw = minDepth / 20n;
    const microGuarded =
      mark === "MICRO" && dustFloorRaw > 0n && (marks[2] < dustFloorRaw || marks[3] < dustFloorRaw);

    return NextResponse.json(
      {
        configured: true,
        via: "oracle",
        chainId: CHAIN_ID,
        market: KURU_BOOK,
        oracle: KURU_ORACLE,
        // Everything under `onchain` came from a contract call, at this block.
        // When a past block was asked for, say so rather than letting it read as live.
        replayOf: atBlock ? atBlock.toString() : null,
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
            // The rule in force on-chain, and whether the dust guard overrode it.
            mark,
            microGuarded,
            dustFloor: Number(dustFloorRaw) / SIZE_PRECISION,
            /**
             * Seconds of time-weighted average the market settles on. Zero is the
             * instantaneous mark — worth showing either way, because which one is in
             * force is the answer to the sharpest question about this design.
             */
            twapWindow: Number(twapWindow),
          },
        },
        // Which oracle the market is routed to, read from the router at this block.
        routed,
        // Whether the book actually moved across the settlement window.
        windowMove,
        /**
         * What it would cost to move the mark by 1%, walked from this ladder.
         *
         * One percent is chosen because it is roughly the width of a band a player
         * would actually paint, so the number answers the real question: what would
         * someone have to spend to push a typical ticket out of the money. It is a
         * lower bound — see costToMoveMark — and the settlement window multiplies it.
         */
        manipulation: (() => {
          const mid = Number(mid8) / 1e8;
          if (!mid) return null;
          const up = costToMoveMark(bids, asks, mid * 1.01);
          const down = costToMoveMark(bids, asks, mid * 0.99);
          return { up, down, targetBps: 100 };
        })(),
        // The same asset on a centralised book, and how far apart the two are.
        basis: cex
          ? {
              ...cex,
              basisBps: ((Number(mid8) / 1e8 - cex.mid) / cex.mid) * 10_000,
              onchainSpreadBps: Number(spreadBps),
            }
          : null,
        // The venue's own rules, read from the book rather than assumed.
        params: {
          tickSize: Number(params[2]) / PRICE_PRECISION,
          minSize: Number(params[3]) / SIZE_PRECISION,
          maxSize: Number(params[4]) / SIZE_PRECISION,
          takerFeeBps: Number(params[5]),
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
