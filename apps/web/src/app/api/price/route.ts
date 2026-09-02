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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = (url.searchParams.get("market") ?? "BTC").toUpperCase();
  const wantHistory = url.searchParams.get("history") === "1";

  try {
    const got = market === "MON" ? await kuruMon() : await binance(BINANCE[market] ?? "BTCUSDT");
    if (got.price <= 0n) throw new Error("non-positive price");

    let returns: number[] | undefined;
    if (wantHistory) {
      // MON has no second-resolution tape anywhere public, so it borrows BTC's
      // dynamics. That is stated on the desk: MON is paper-only and not fundable.
      const symbol = BINANCE[market] ?? "BTCUSDT";
      const closes = await binanceHistory(symbol, 1000);
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
