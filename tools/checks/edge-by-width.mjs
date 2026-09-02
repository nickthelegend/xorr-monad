/**
 * House edge as a function of band width, measured against real tape.
 *
 * A well-shaped market charges roughly the same edge whatever band you paint. If the
 * edge swings from a few percent at one width to a third of the stake at another, the
 * distribution table does not fit the data uniformly and some bands are quietly a much
 * worse deal than others — including, possibly, the one the desk picks by default.
 */
const { CALIBRATED_MARKETS } = await import("../../packages/sdk/src/generated/markets.ts");
const { quote, bandLimits } = await import("../../packages/sdk/src/pricing.ts");

async function realCloses(symbol, want) {
  const closes = [];
  let endTime;
  while (closes.length < want) {
    const u = new URL("https://api.binance.com/api/v3/klines");
    u.searchParams.set("symbol", symbol);
    u.searchParams.set("interval", "1s");
    u.searchParams.set("limit", "1000");
    if (endTime) u.searchParams.set("endTime", String(endTime));
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`binance ${r.status}`);
    const b = await r.json();
    if (!b.length) break;
    closes.unshift(...b.map((k) => Number(k[4])));
    endTime = Number(b[0][0]) - 1;
    if (b.length < 1000) break;
  }
  return closes;
}

function empiricalProb(closes, seconds, halfFrac) {
  let inside = 0, total = 0;
  const step = Math.max(1, Math.floor(seconds / 4));
  for (let i = 0; i + seconds < closes.length; i += step) {
    const ratio = closes[i + seconds] / closes[i];
    if (ratio >= 1 - halfFrac && ratio <= 1 + halfFrac) inside++;
    total++;
  }
  return total === 0 ? 0 : inside / total;
}

const closes = await realCloses("BTCUSDT", 60_000);
const m = CALIBRATED_MARKETS.find((x) => x.key === "BTC");
const SPOT = 77_000_00000000n;

console.log(`measured on ${closes.length} real one-second closes\n`);

for (const tier of [0, 2, 5]) {
  const r = m.rounds[tier];
  const l = bandLimits(r.probTable, SPOT, r.sigma1e4, 400n, 12_000n, r.minProb1e6);
  console.log(`--- ${r.seconds}s round (tier ${tier}) ---`);
  console.log("halfBps   model%   real%    mult     edge");

  for (let f = 0; f <= 10; f++) {
    const half1e4 = l.minHalfWidth1e4 + ((l.maxHalfWidth1e4 - l.minHalfWidth1e4) * BigInt(f)) / 10n;
    const half = (SPOT * half1e4) / 100_000_000n;
    if (half <= 0n) continue;
    let q;
    try { q = quote(r.probTable, SPOT, SPOT - half, SPOT + half, r.sigma1e4, 400n); } catch { continue; }
    const mult = q.multiplierBps > r.maxMultiplierBps ? r.maxMultiplierBps : q.multiplierBps;
    if (mult < 12_000n) continue;

    const halfFrac = Number(half1e4) / 1e8;
    const real = empiricalProb(closes, r.seconds, halfFrac);
    const ev = real * (Number(mult) / 1e4);
    const mark = f === 5 ? "  <-- desk default" : "";
    console.log(
      `${(Number(half1e4) / 1e4).toFixed(2).padStart(7)}  ${(Number(q.prob1e6) / 1e4).toFixed(1).padStart(6)}  ` +
        `${(real * 100).toFixed(1).padStart(6)}  ${(Number(mult) / 1e4).toFixed(2).padStart(6)}x  ` +
        `${((1 - ev) * 100).toFixed(1).padStart(6)}%${mark}`,
    );
  }
  console.log();
}
