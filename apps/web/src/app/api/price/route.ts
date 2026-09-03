import { NextResponse } from "next/server";

/**
 * Real spot prices, fetched server-side.
 *
 * The demo desk needs a genuine price to start its walk from, and the browser cannot
 * always reach an exchange directly. This does the call server-side against the real
 * public APIs and normalises to the same 8-decimal fixed point the market settles on.
 *
 * There is deliberately no fallback price. If the upstream is unreachable this returns
 * an error and the desk says so, rather than opening a market on a number nobody
 * observed.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BINANCE: Record<string, string> = { BTC: "BTCUSDT", ETH: "ETHUSDT" };

/** Kuru is Monad's onchain CLOB; MON-AUSD is the native pair XORR marks against. */
const KURU_MON_AUSD = "0x131a2e70a5b31a517a74b8c567149bc294470da9";

/** Decimal string -> 8dp fixed point, without touching floating point. */
function to8dp(s: string): bigint {
  const [w, d = ""] = s.trim().split(".");
  return BigInt(w || "0") * 100_000_000n + BigInt((d + "00000000").slice(0, 8));
}

/**
 * Recent one-second closes. The demo desk walks its price by replaying these real
 * returns rather than drawing from a bell curve: the pricing tables were measured on
 * exactly this data, so replaying it is what makes the desk's realised win rate match
 * the probability it quotes.
 */
async function binanceHistory(symbol: string, limit: number) {
  const r = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1s&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000), cache: "no-store" },
  );
  if (!r.ok) throw new Error(`binance klines ${r.status}`);
  const rows = (await r.json()) as unknown[][];
  return rows.map((k) => Number(k[4]));
}

async function binance(symbol: string) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const j = (await r.json()) as { price: string };
  return { price: to8dp(j.price), source: `binance:${symbol}` };
}

async function kuruMon() {
  const r = await fetch(`https://api.kuru.io/api/v1/markets/${KURU_MON_AUSD}`, {
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`kuru ${r.status}`);
  const j = (await r.json()) as { data?: { lastPrice?: string | number } };
  const last = j.data?.lastPrice;
  if (last === undefined || last === null) throw new Error("kuru: no lastPrice");
  return { price: to8dp(String(last)), source: "kuru:MON-AUSD" };
}

/**
 * A short server-side cache, and a cap on how often one caller may miss it.
 *
 * Every open desk polls this, so on a public host the upstreams see the sum of all
 * visitors rather than one client. Binance answers that with a 418 and then a ban, at
 * which point the desk correctly refuses to show a price and the demo is over — a
 * self-inflicted outage that looks exactly like the honest failure it is designed to
 * report.
 *
 * The cache is deliberately shorter than the desk's own poll interval for spot, so the
 * price on screen still moves; history is a thousand one-second closes that change far
 * more slowly than they cost to fetch, so it is held longer. Neither is a fallback: a
 * miss on a dead upstream still returns the error. A stale-but-real price is served for
 * a few seconds; a made-up one never is.
 */
const SPOT_TTL_MS = 1_000;
const HISTORY_TTL_MS = 15_000;

type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();
/** In-flight fetches, so N simultaneous misses make one upstream call, not N. */
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = fetcher()
    .then((v) => {
      cache.set(key, { at: Date.now(), value: v });
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p as Promise<unknown>);
  return p;
}

/**
 * Per-caller rate limit.
 *
 * The cache already protects the upstream; this protects the host from one client
 * looping on it. A fixed window is enough here — the limit is generous relative to the
 * desk's real poll rate, so a normal visitor never sees it, and the failure mode of
 * being slightly too permissive at a window boundary is uninteresting.
 */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 60;
const hits = new Map<string, { windowStart: number; n: number }>();

function overLimit(who: string): boolean {
  const now = Date.now();
  const h = hits.get(who);
  if (!h || now - h.windowStart >= RATE_WINDOW_MS) {
    hits.set(who, { windowStart: now, n: 1 });
    if (hits.size > 5_000) {
      // Bound the map. Anything whose window has passed cannot be over the limit.
      for (const [k, v] of hits) if (now - v.windowStart >= RATE_WINDOW_MS) hits.delete(k);
    }
    return false;
  }
  h.n += 1;
  return h.n > RATE_MAX;
}

function callerOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : null)?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = (url.searchParams.get("market") ?? "BTC").toUpperCase();
  const wantHistory = url.searchParams.get("history") === "1";

  if (overLimit(callerOf(req))) {
    return NextResponse.json(
      { market, error: `rate limited: more than ${RATE_MAX} requests in ${RATE_WINDOW_MS / 1000}s` },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(Math.ceil(RATE_WINDOW_MS / 1000)),
        },
      },
    );
  }

  try {
    const got = await cached(`spot:${market}`, SPOT_TTL_MS, () =>
      market === "MON" ? kuruMon() : binance(BINANCE[market] ?? "BTCUSDT"),
    );
    if (got.price <= 0n) throw new Error("non-positive price");

    let returns: number[] | undefined;
    if (wantHistory) {
      // MON has no second-resolution tape anywhere public, so it borrows BTC's
      // dynamics. That is stated on the desk: MON is paper-only and not fundable.
      const symbol = BINANCE[market] ?? "BTCUSDT";
      const closes = await cached(`hist:${symbol}`, HISTORY_TTL_MS, () =>
        binanceHistory(symbol, 1000),
      );
      returns = [];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0 && closes[i] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }

    return NextResponse.json(
      {
        market,
        price: got.price.toString(),
        decimals: 8,
        source: got.source,
        at: Date.now(),
        ...(returns ? { returns, returnsInterval: "1s" } : {}),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { market, error: (e as Error).message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
