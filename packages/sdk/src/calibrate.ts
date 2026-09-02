/**
 * Volatility calibration for XORR markets.
 *
 * RangeMarket prices every band off one number per market: `volBps`, the one-sigma
 * move over 100 blocks (~30s at Monad's 300ms cadence). Get it wrong and the whole
 * pricing surface shifts, so this derives it from real trades instead of taste.
 *
 * The asymmetry that matters:
 *
 *   EV(vault) per unit staked = p_true * offeredMultiplier
 *                             = p_true / p_assumed * (1 - houseEdge)
 *
 *   OVERESTIMATING vol makes bands look harder than they are, inflates the
 *   multiplier, and bleeds the vault. UNDERESTIMATING vol makes them look easier,
 *   shrinks the multiplier, and pads the vault. So the safe direction is down, and
 *   this tool applies a deliberate haircut before recommending a number.
 *
 * Usage:  node src/calibrate.ts [SYMBOL]        (default BTCUSDT)
 */

const SYMBOL = process.argv[2] ?? "BTCUSDT";
const BLOCK_MS = 300;
const REF_BLOCKS = 100; // volBps is quoted over this many blocks
const REF_SECONDS = (BLOCK_MS * REF_BLOCKS) / 1000; // 30s

interface Kline {
  openTime: number;
  close: number;
}

async function klines(symbol: string, interval: string, limit: number, endTime?: number): Promise<Kline[]> {
  const u = new URL("https://api.binance.com/api/v3/klines");
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  if (endTime) u.searchParams.set("endTime", String(endTime));
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`binance ${r.status}: ${await r.text()}`);
  const raw = (await r.json()) as unknown[][];
  return raw.map((k) => ({ openTime: Number(k[0]), close: Number(k[4]) }));
}

/** Paginate backwards until we have `want` candles. */
async function fetchHistory(symbol: string, interval: string, want: number): Promise<Kline[]> {
  const out: Kline[] = [];
  let endTime: number | undefined;
  while (out.length < want) {
    const batch = await klines(symbol, interval, 1000, endTime);
    if (batch.length === 0) break;
    out.unshift(...batch);
    endTime = batch[0].openTime - 1;
    if (batch.length < 1000) break;
  }
  return out.slice(-want);
}

function logReturns(ks: Kline[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < ks.length; i++) {
    if (ks[i - 1].close > 0 && ks[i].close > 0) r.push(Math.log(ks[i].close / ks[i - 1].close));
  }
  return r;
}

function stdev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Excess kurtosis. 0 is normal; crypto at second resolution runs very high. */
function kurtosis(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const s = stdev(xs);
  return xs.reduce((a, b) => a + ((b - m) / s) ** 4, 0) / xs.length - 3;
}

function pct(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

async function main() {
  console.log(`\nXORR volatility calibration — ${SYMBOL}`);
  console.log("=".repeat(64));

  const min1 = await fetchHistory(SYMBOL, "1m", 43_200); // 30 days
  const sec1 = await fetchHistory(SYMBOL, "1s", 20_000); // ~5.5 hours

  const r1m = logReturns(min1);
  const r1s = logReturns(sec1);

  const sd1m = stdev(r1m);
  const sd1s = stdev(r1s);

  console.log(`\n1-minute candles : ${r1m.length} returns over ${(r1m.length / 1440).toFixed(1)} days`);
  console.log(`  sigma           : ${(sd1m * 1e4).toFixed(2)} bps`);
  console.log(`  excess kurtosis : ${kurtosis(r1m).toFixed(1)}`);
  console.log(`\n1-second candles : ${r1s.length} returns over ${(r1s.length / 3600).toFixed(1)} hours`);
  console.log(`  sigma           : ${(sd1s * 1e4).toFixed(3)} bps`);
  console.log(`  excess kurtosis : ${kurtosis(r1s).toFixed(1)}`);

  // Does volatility actually scale with sqrt(time) down here? Pricing assumes it does.
  const impliedFrom1s = sd1s * Math.sqrt(60);
  console.log(`\nsqrt-time check`);
  console.log(`  sigma(1s) * sqrt(60) = ${(impliedFrom1s * 1e4).toFixed(2)} bps`);
  console.log(`  sigma(1m) measured   = ${(sd1m * 1e4).toFixed(2)} bps`);
  console.log(`  ratio                = ${(impliedFrom1s / sd1m).toFixed(3)}  (1.000 = perfect scaling)`);

  // Sigma over the 30s reference horizon, from both sources.
  const from1s = sd1s * Math.sqrt(REF_SECONDS) * 1e4;
  const from1m = sd1m * Math.sqrt(REF_SECONDS / 60) * 1e4;

  console.log(`\nsigma over ${REF_SECONDS}s (${REF_BLOCKS} blocks)`);
  console.log(`  from 1s data : ${from1s.toFixed(2)} bps`);
  console.log(`  from 1m data : ${from1m.toFixed(2)} bps`);

  // Take the lower of the two and haircut it. Underestimating vol is the safe side:
  // it shrinks the multiplier we offer, which pads the vault rather than draining it.
  const HAIRCUT = 0.85;
  const recommended = Math.max(1, Math.round(Math.min(from1s, from1m) * HAIRCUT));

  console.log(`\n  recommended volBps = ${recommended}   (min of the two, x${HAIRCUT} haircut)`);
  console.log(`  set with: range.setVol(keccak256("${SYMBOL.replace("USDT", "-USD")}"), ${recommended})`);

  // How wrong can the estimate be before the house edge stops covering it?
  // Break-even needs p_true/p_assumed <= 1/(1-edge).
  const edge = 0.04;
  console.log(`\nrisk budget`);
  console.log(`  a ${(edge * 100).toFixed(0)}% house edge survives p_true up to ${(100 / (1 - edge) - 100).toFixed(2)}% above p_assumed`);
  console.log(`  on a 1-sigma band that is roughly a 5.8% overestimate of vol before EV turns negative`);
  console.log(`  the ${HAIRCUT} haircut buys ${((1 / HAIRCUT - 1) * 100).toFixed(0)}% of headroom on top of that\n`);

  console.log(`tail check (pricing assumes normal; these are the real 1s moves)`);
  console.log(`  p01 / p99 : ${(pct(r1s, 0.01) * 1e4).toFixed(2)} / ${(pct(r1s, 0.99) * 1e4).toFixed(2)} bps`);
  console.log(`  normal    : ${(-2.326 * sd1s * 1e4).toFixed(2)} / ${(2.326 * sd1s * 1e4).toFixed(2)} bps`);
  console.log(
    `  fat tails put MORE mass outside a band than the normal predicts, so a "stay inside"\n` +
      `  ticket is genuinely harder than priced. That error runs in the vault's favour.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
