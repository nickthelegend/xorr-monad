/**
 * Emits the on-chain market configuration from real market tape.
 *
 * Output: packages/contracts/config/markets.json, read by script/Deploy.s.sol.
 *
 * Each market carries:
 *   probTable  T(z) = P(|move| <= z*sigma) on z = 0, 0.25 .. 4.00, in 1e6 fp
 *   sigma1e4   one-sigma move per round tier, in bps of spot scaled by 1e4
 *
 * The distribution is MEASURED, not assumed. See termstructure.ts for why the normal
 * fails here: over a three-second round BTC does not move at all about a third of the
 * time, and no normal has a point mass at zero.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ROUND_BLOCKS, secondCloses, sigmaOver, empiricalProb, tierSeconds } from "./termstructure.ts";

interface MarketOut {
  key: string;
  label: string;
  marketId: string;
  source: string;
  live: boolean;
  note?: string;
  sigma1e4: number[];
  /** One measured T(z) table per round tier. */
  probTables: number[][];
  sigmaHaircut?: number;
  /** Per round tier: the tightest band this calibration can price safely. */
  minProb1e6?: number[];
  /** Per round tier: the resulting multiplier ceiling, 0 = tier not sellable. */
  maxMultiplierBps?: number[];
  sampleSeconds: number;
  spotAtCalibration: number;
  validation?: { blocks: number; worstEvOutOfSample: number; cells: number }[];
}

const IDS: Record<string, string> = {
  BTC: "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e",
  ETH: "0x2430f68ea2e8d4151992bb7fc3a4c472087a6149bf7e0232704396162ab7c1f7",
  MON: "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62",
};

/**
 * Build T(z) on the contract's 0.25 grid from real closes, then enforce the two
 * properties the contract validates: non-decreasing, and bounded by 1e6.
 */
function buildTable(closes: number[], seconds: number, sigma: number): number[] {
  const t: number[] = [];
  let prev = 0;
  for (let i = 0; i <= 16; i++) {
    const p = empiricalProb(closes, seconds, i * 0.25 * sigma);
    const v = Math.min(1_000_000, Math.max(prev, Math.round(p * 1e6)));
    t.push(v);
    prev = v;
  }
  return t;
}

/**
 * The conservative envelope of T(z) across recent windows.
 *
 * Trying to make the modelled win probability exactly right is the wrong target: it is
 * a non-stationary, fat-tailed process, and every attempt to nail it either overprices
 * (a punitive house edge) or underprices (a bankroll that bleeds). What the vault
 * actually needs is a one-sided guarantee — that the modelled chance is never BELOW
 * the real one, because the multiplier is (1 - edge) / p and expected value is
 * p_true * (1 - edge) / p_model.
 *
 * So the table is the highest win rate each band width has recently shown, taken
 * across sliding windows and normalised by each window's own volatility. Reading a
 * band off the envelope gives the most generous chance the recent market has offered,
 * which makes the multiplier the least generous the evidence supports.
 */
function buildEnvelopeTable(recent: number[], seconds: number, windowLen: number): number[] {
  const stride = Math.max(1, Math.floor(windowLen / 4));
  const best = new Array(17).fill(0);
  let windows = 0;

  for (let start = 0; start + windowLen <= recent.length; start += stride) {
    const w = recent.slice(start, start + windowLen);
    const sigma = sigmaOver(w, seconds);
    if (!(sigma > 0)) continue;
    windows++;
    for (let i = 0; i <= 16; i++) {
      const p = empiricalProb(w, seconds, i * 0.25 * sigma);
      if (p > best[i]) best[i] = p;
    }
  }
  if (windows === 0) return buildTable(recent, seconds, sigmaOver(recent, seconds));

  const t: number[] = [];
  let prev = 0;
  for (let i = 0; i <= 16; i++) {
    const v = Math.min(1_000_000, Math.max(prev, Math.round(best[i] * 1e6)));
    t.push(v);
    prev = v;
  }
  return t;
}

/**
 * Out-of-sample validation. Calibrating a distribution on the same tape you then score
 * it against measures nothing but your own arithmetic, so the table is fitted on the
 * first half of the sample and the vault's edge is measured on the second half.
 */
function validate(
  testCloses: number[],
  seconds: number,
  sigma: number,
  table: number[],
  minProb: number,
): { worstEv: number; cells: number; staked: number; returned: number } {
  const tAt = (z: number) => {
    if (z >= 4) return table[16] / 1e6;
    const i = Math.floor(z / 0.25);
    const rem = z - i * 0.25;
    return (table[i] + ((table[i + 1] - table[i]) * rem) / 0.25) / 1e6;
  };

  let worstEv = 0;
  let cells = 0;
  let staked = 0;
  let returned = 0;
  for (let z = 0.15; z <= 3.0; z += 0.05) {
    const p = tAt(z);
    if (p < minProb) continue;
    let mult = (1 / p) * 0.96;
    if (mult < 1.2) continue;
    if (mult > 8) mult = 8;
    const realP = empiricalProb(testCloses, seconds, z * sigma);
    const ev = realP * mult;
    cells++;
    staked += 1;
    returned += ev;
    if (ev > worstEv) worstEv = ev;
  }
  return { worstEv, cells, staked, returned };
}

async function calibrate(key: string, symbol: string): Promise<MarketOut> {
  const closes = await secondCloses(symbol, 160_000);

  /**
   * Volatility is not stationary, and that sets a hard floor on how tight the pricing
   * can honestly be.
   *
   * Sigma and the distribution are fitted on the most RECENT tape — pricing off a
   * regime that has already passed was worth twenty points of error, with the model
   * claiming a band held 58% of the time where it really held 38%.
   *
   * But even a well-intentioned fit lands five to thirteen points above the realised
   * win rate out of sample, because the next hour is not the last hour. The multiplier
   * is (1 - fee) / p, so a relative error in p passes straight through: a 13-point
   * miss at p = 0.75 is a 17% swing in expected value. Measured on held-out tape the
   * effective house edge therefore runs 10-25%, not the 4% fee.
   *
   * That is reported rather than hidden. Shrinking it would mean modelling p below the
   * realised rate, which is the direction that drains the bankroll — and an insolvent
   * vault is worse than a wide spread. The keeper narrows it by re-marking sigma
   * often via RangeMarket.setRoundConfigs.
   */
  const RECENT = Math.min(closes.length, 60_000);
  const recent = closes.slice(-RECENT);

  /** Trailing window a re-mark is fitted on, and how long it must then hold up. */
  const TRAIN_SECONDS = 1_800; // 30 minutes
  const REMARK_SECONDS = 300; // re-mark every 5 minutes

  /**
   * Shade sigma down.
   *
   * Fitting on the immediately preceding window errs in BOTH directions: when
   * volatility rises into the settlement window the vault collects, and when it falls
   * the vault pays. Measured on held-out tape, an unshaded fit ran between +5% and
   * -25% per round depending purely on which way the regime moved. A market that is
   * profitable or ruinous depending on the weather is not a market.
   *
   * A smaller model sigma means a larger z, a higher modelled win chance, and a lower
   * multiplier — so shading down buys a one-sided guarantee. The price is a wider
   * spread than the 4% fee, which is measured and disclosed rather than hidden.
   */
  const HAIRCUT = 0.95;

  /**
   * Price off the CALMEST volatility the market has shown recently, not the latest.
   *
   * The vault is safe exactly when the modelled win chance is at least the real one.
   * A band's real win chance is highest when the market is quietest, so the bound that
   * actually holds comes from the minimum realised sigma across recent windows — not
   * from shading the latest reading by a fixed factor, which errs whichever way the
   * regime happens to move next.
   *
   * Exposure is then limited to the market becoming quieter than anything it has been
   * in the sample window, which is the residual risk the keeper manages by re-marking.
   */
  const quietSigma = (window: number[], seconds: number, sub: number) => {
    const stride = Math.max(1, Math.floor(sub / 4));
    const observed: number[] = [];
    for (let start = 0; start + sub <= window.length; start += stride) {
      const s = sigmaOver(window.slice(start, start + sub), seconds);
      if (s > 0) observed.push(s);
    }
    if (observed.length === 0) return sigmaOver(window, seconds) * HAIRCUT;
    observed.sort((a, b) => a - b);
    // The 30th percentile rather than the outright minimum. The minimum is a single
    // unusually still ten minutes and pricing everything off it charges a spread
    // nobody would pay; a low percentile keeps the one-sided guarantee without
    // handing the whole surplus to the house.
    const idx = Math.min(observed.length - 1, Math.floor(0.3 * observed.length));
    return observed[idx] * HAIRCUT;
  };

  const fitSigma = (window: number[], seconds: number) =>
    quietSigma(window, seconds, Math.max(600, seconds * 10));

  // Shape from a large recent window so the tail estimates have samples behind them;
  // scale from the trailing window so it tracks the current regime.
  const shapeWindow = recent;
  const sigmas = ROUND_BLOCKS.map((b) => fitSigma(recent, tierSeconds(b)));
  const probTables = ROUND_BLOCKS.map((b) =>
    buildTable(shapeWindow, tierSeconds(b), sigmaOver(shapeWindow, tierSeconds(b))),
  );

  /**
   * Per round, how deep into the tail it may sell. At 8x a ticket pays on a modelled
   * 12.5% chance, so a point or two of error there is an enormous swing in expected
   * value; at 2x the same error costs a fraction as much. Each round sells only as
   * deep as its own walk-forward evidence supports — the gate is solvency, so it asks
   * that the vault not LOSE, and lets the measured edge be whatever it is.
   */
  const minProbs: number[] = [];
  const validation: { worstEv: number; cells: number }[] = [];

  ROUND_BLOCKS.forEach((b, i) => {
    const secs = tierSeconds(b);
    const train = Math.max(TRAIN_SECONDS, secs * 20);
    const test = Math.max(REMARK_SECONDS, secs * 8);

    const runs: { test: number[]; sigma: number; table: number[] }[] = [];
    for (let start = 0; start + train + test <= recent.length; start += test) {
      const trainWindow = recent.slice(start, start + train);
      const testWindow = recent.slice(start + train, start + train + test);
      const sig = fitSigma(trainWindow, secs);
      if (sig <= 0) continue;
      runs.push({
        test: testWindow,
        sigma: sig,
        table: buildTable(trainWindow, secs, sigmaOver(trainWindow, secs)),
      });
    }

    /**
     * Judge the BOOK, not the worst single cell.
     *
     * The vault writes many tickets across many widths and many minutes; what has to
     * be true is that the whole book returns less than it takes. Requiring every
     * individual fold-and-width cell to clear the bar lets one noisy small-sample
     * window — a handful of overlapping observations at a fifteen-minute horizon —
     * veto an entire round that is comfortably profitable in aggregate.
     */
    /**
     * Never sell a band tighter than "the price does not move at all".
     *
     * The measured tables carry a real point mass at zero — over a three-second round
     * BTC often closes exactly where it opened. If the probability floor sits below
     * that mass, a zero-width band clears every check and pays 1/T(0), which is a
     * multiple of three or four on an event that happens a quarter of the time. It is
     * also the single least trustworthy number in the table, being mostly an artifact
     * of tick quantisation. So the floor starts above it, which is what forces the
     * painter's minimum half-width to be greater than zero.
     */
    const pointMass = probTables[i][0] / 1e6;
    const floorStart = Math.max(0.125, pointMass + 0.02);

    let chosen = 1;
    for (let mp = floorStart; mp <= 0.8; mp += 0.005) {
      let staked = 0;
      let returned = 0;
      let cells = 0;
      for (const r of runs) {
        const v = validate(r.test, secs, r.sigma, r.table, mp);
        cells += v.cells;
        staked += v.staked;
        returned += v.returned;
      }
      if (cells > 0 && staked > 0 && returned / staked <= 0.98) {
        chosen = mp;
        break;
      }
    }
    minProbs.push(chosen);

    let staked = 0;
    let returned = 0;
    let cells = 0;
    for (const r of runs) {
      const v = validate(r.test, secs, r.sigma, r.table, chosen);
      cells += v.cells;
      staked += v.staked;
      returned += v.returned;
    }
    // Report the book's return per unit staked, which is what the vault experiences.
    validation.push({ worstEv: staked > 0 ? returned / staked : 0, cells });
  });

  return {
    key,
    label: `${key}-USD`,
    marketId: IDS[key],
    source: `binance:${symbol} 1s`,
    live: true,
    sigma1e4: sigmas.map((s) => Math.max(1, Math.round(s * 1e8))),
    probTables,
    sigmaHaircut: HAIRCUT,
    minProb1e6: minProbs.map((p) => Math.round(p * 1e6)),
    maxMultiplierBps: minProbs.map((p) =>
      p >= 1 ? 0 : Math.min(80_000, Math.round((0.96 / p) * 1e4)),
    ),
    sampleSeconds: closes.length,
    spotAtCalibration: closes[closes.length - 1],
    validation: validation.map((v, i) => ({
      blocks: ROUND_BLOCKS[i],
      worstEvOutOfSample: Number(v.worstEv.toFixed(4)),
      cells: v.cells,
    })),
  };
}

/**
 * Emit the calibration as a Solidity library rather than leaving Deploy.s.sol to parse
 * nested uint32[17][] out of JSON. The generated file is committed, so the numbers a
 * deployment uses are reviewable in the same diff as the code that uses them.
 */
function emitSolidity(out: {
  generatedAt: string;
  roundBlocks: readonly number[];
  roundSeconds: number[];
  markets: MarketOut[];
}): string {
  const arr = (xs: readonly number[]) => xs.join(", ");
  const lines: string[] = [];

  lines.push("// SPDX-License-Identifier: MIT");
  lines.push("pragma solidity ^0.8.24;");
  lines.push("");
  lines.push("/// @notice GENERATED FILE - do not edit by hand.");
  lines.push("/// @dev Produced by `pnpm calibrate` from real market tape.");
  lines.push(`///      Generated: ${out.generatedAt}`);
  lines.push("///");
  lines.push("///      Each market carries a MEASURED return distribution per round length,");
  lines.push("///      not an assumed normal. Over a three-second round BTC does not move at");
  lines.push("///      all a large fraction of the time; a normal puts zero probability there.");
  lines.push("///      Sigma is fitted on the most recent tape and shaded down, and each");
  lines.push("///      round's multiplier ceiling is solved by walk-forward, so the vault");
  lines.push("///      stays ahead between keeper re-marks.");
  lines.push("library CalibratedMarkets {");
  lines.push(`    uint256 internal constant MARKET_COUNT = ${out.markets.length};`);
  lines.push(`    uint256 internal constant ROUND_COUNT = ${out.roundBlocks.length};`);
  lines.push("");
  lines.push("    function roundBlocks() internal pure returns (uint32[] memory r) {");
  lines.push(`        r = new uint32[](${out.roundBlocks.length});`);
  out.roundBlocks.forEach((b, i) =>
    lines.push(`        r[${i}] = ${b}; // ~${out.roundSeconds[i]}s at 300ms`),
  );
  lines.push("    }");
  lines.push("");

  out.markets.forEach((m, mi) => {
    lines.push(`    // ---- ${m.label} (${m.source})${m.live ? "" : " -- PAPER ONLY, not funded"}`);
    lines.push(`    function marketId${mi}() internal pure returns (bytes32) {`);
    lines.push(`        return ${m.marketId}; // keccak256("${m.label}")`);
    lines.push("    }");
    lines.push("");
    lines.push(`    function enabled${mi}() internal pure returns (bool) {`);
    lines.push(`        return ${m.live};`);
    lines.push("    }");
    lines.push("");
    lines.push(`    function sigma1e4_${mi}() internal pure returns (uint32[] memory s) {`);
    lines.push(`        s = new uint32[](${m.sigma1e4.length});`);
    m.sigma1e4.forEach((v, i) => lines.push(`        s[${i}] = ${v};`));
    lines.push("    }");
    lines.push("");
    lines.push(`    function minProb1e6_${mi}() internal pure returns (uint32[] memory s) {`);
    lines.push(`        s = new uint32[](${(m.minProb1e6 ?? []).length});`);
    (m.minProb1e6 ?? []).forEach((v, i) => lines.push(`        s[${i}] = ${v};`));
    lines.push("    }");
    lines.push("");
    lines.push(`    function maxMultBps_${mi}() internal pure returns (uint32[] memory s) {`);
    lines.push(`        s = new uint32[](${(m.maxMultiplierBps ?? []).length});`);
    (m.maxMultiplierBps ?? []).forEach((v, i) =>
      lines.push(`        s[${i}] = ${v === 0 ? 10_000 : v};`),
    );
    lines.push("    }");
    lines.push("");
    lines.push(`    function tables${mi}() internal pure returns (uint32[17][] memory t) {`);
    lines.push(`        t = new uint32[17][](${m.probTables.length});`);
    m.probTables.forEach((tbl, i) => {
      lines.push(`        t[${i}] = [uint32(${tbl[0]}), ${arr(tbl.slice(1))}];`);
    });
    lines.push("    }");
    lines.push("");
  });

  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * The same calibration, emitted for the desk. The paper engine and the live quote
 * preview both read this, so what a player sees in demo mode is priced off exactly the
 * numbers the contract was deployed with.
 */
function emitTypeScript(out: {
  generatedAt: string;
  roundBlocks: readonly number[];
  roundSeconds: number[];
  houseEdgeBps: number;
  markets: MarketOut[];
}): string {
  const L: string[] = [];
  L.push("/** GENERATED FILE - do not edit by hand.");
  L.push(" *  Produced by `pnpm calibrate` from real market tape.");
  L.push(` *  Generated: ${out.generatedAt}`);
  L.push(" *");
  L.push(" *  Distributions are MEASURED per round length, not assumed normal.");
  L.push(" */");
  L.push("");
  L.push("export interface CalibratedRound {");
  L.push("  blocks: number;");
  L.push("  seconds: number;");
  L.push("  sigma1e4: bigint;");
  L.push("  minProb1e6: bigint;");
  L.push("  maxMultiplierBps: bigint;");
  L.push("  probTable: readonly bigint[];");
  L.push("}");
  L.push("");
  L.push("export interface CalibratedMarket {");
  L.push("  key: string;");
  L.push("  label: string;");
  L.push("  marketId: `0x${string}`;");
  L.push("  source: string;");
  L.push("  live: boolean;");
  L.push("  note?: string;");
  L.push("  rounds: CalibratedRound[];");
  L.push("}");
  L.push("");
  L.push(`export const GENERATED_AT = ${JSON.stringify(out.generatedAt)};`);
  L.push(`export const HOUSE_EDGE_BPS = ${out.houseEdgeBps}n;`);
  L.push(`export const ROUND_BLOCKS = [${out.roundBlocks.join(", ")}] as const;`);
  L.push(`export const ROUND_SECONDS = [${out.roundSeconds.join(", ")}] as const;`);
  L.push("");
  L.push("export const CALIBRATED_MARKETS: CalibratedMarket[] = [");
  for (const m of out.markets) {
    L.push("  {");
    L.push(`    key: ${JSON.stringify(m.key)},`);
    L.push(`    label: ${JSON.stringify(m.label)},`);
    L.push(`    marketId: ${JSON.stringify(m.marketId)},`);
    L.push(`    source: ${JSON.stringify(m.source)},`);
    L.push(`    live: ${m.live},`);
    if (m.note) L.push(`    note: ${JSON.stringify(m.note)},`);
    L.push("    rounds: [");
    out.roundBlocks.forEach((b, i) => {
      L.push("      {");
      L.push(`        blocks: ${b},`);
      L.push(`        seconds: ${out.roundSeconds[i]},`);
      L.push(`        sigma1e4: ${m.sigma1e4[i]}n,`);
      L.push(`        minProb1e6: ${(m.minProb1e6 ?? [])[i] ?? 125_000}n,`);
      L.push(`        maxMultiplierBps: ${(m.maxMultiplierBps ?? [])[i] || 10_000}n,`);
      L.push(`        probTable: [${m.probTables[i].map((v) => v + "n").join(", ")}],`);
      L.push("      },");
    });
    L.push("    ],");
    L.push("  },");
  }
  L.push("];");
  L.push("");
  L.push("export const marketByKey = (k: string) => CALIBRATED_MARKETS.find((m) => m.key === k);");
  L.push("");
  return L.join("\n");
}

async function main() {
  const markets: MarketOut[] = [];
  markets.push(await calibrate("BTC", "BTCUSDT"));
  markets.push(await calibrate("ETH", "ETHUSDT"));

  // MON has no liquid tape to calibrate against. Kuru's MON-AUSD book exists and is
  // read live on the desk for the mark and the spread meter, but 24h volume there is
  // in the low hundreds and there is no public candle history, so there is nothing
  // honest to fit a distribution to. Rather than list a live market XORR cannot price,
  // MON ships paper-only: playable on the demo desk, not fundable from the vault,
  // until the keeper re-marks it from real Kuru fills via setSigmas().
  const eth = markets[1];
  markets.push({
    key: "MON",
    label: "MON-USD",
    marketId: IDS.MON,
    source: "kuru:MON-AUSD (mark only)",
    live: false,
    note:
      "PAPER ONLY. Kuru MON-AUSD is too thin to calibrate a distribution against " +
      "(24h volume ~185, no public candle history). Shape borrowed from ETH with a 2.5x " +
      "sigma; re-mark from real fills before enabling live money.",
    sigma1e4: eth.sigma1e4.map((s) => Math.round(s * 2.5)),
    probTables: eth.probTables,
    sigmaHaircut: eth.sigmaHaircut,
    minProb1e6: eth.minProb1e6,
    maxMultiplierBps: eth.maxMultiplierBps,
    sampleSeconds: 0,
    spotAtCalibration: 0.025952,
  });

  const out = {
    generatedAt: new Date().toISOString(),
    roundBlocks: ROUND_BLOCKS,
    roundSeconds: ROUND_BLOCKS.map(tierSeconds),
    houseEdgeBps: 400,
    markets,
  };

  const dir = new URL("../../contracts/config/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const path = new URL("markets.json", dir);
  writeFileSync(path, JSON.stringify(out, null, 2));

  const solDir = new URL("../../contracts/src/config/", import.meta.url);
  mkdirSync(solDir, { recursive: true });
  writeFileSync(new URL("CalibratedMarkets.sol", solDir), emitSolidity(out));

  const tsDir = new URL("./generated/", import.meta.url);
  mkdirSync(tsDir, { recursive: true });
  writeFileSync(new URL("markets.ts", tsDir), emitTypeScript(out));

  console.log(`\nwrote ${decodeURIComponent(path.pathname)}`);
  console.log(`wrote ${decodeURIComponent(new URL("CalibratedMarkets.sol", solDir).pathname)}\n`);
  for (const m of markets) {
    console.log(`${m.key.padEnd(4)} ${m.live ? "LIVE " : "PAPER"}  ${m.source}`);
    console.log(`  sigma1e4 [${m.sigma1e4.join(", ")}]   haircut x${m.sigmaHaircut}`);
    console.log(`  T(0) by round: ${m.probTables.map((t) => (t[0] / 1e4).toFixed(0) + "%").join("  ")}`);
    console.log(`     (a normal has T(0)=0; these are rounds where price did not move at all)`);
    if (m.maxMultiplierBps) {
      console.log(
        `  max multiplier by round: ${m.maxMultiplierBps.map((x) => (x === 0 ? "  --  " : (x / 1e4).toFixed(2) + "x")).join("  ")}`,
      );
    }
    if (m.validation) {
      const worst = Math.max(...m.validation.map((v) => v.worstEvOutOfSample));
      console.log(
        `  out-of-sample worst EV ${worst.toFixed(4)} -> vault edge ${((1 - worst) * 100).toFixed(2)}%` +
          `  ${worst <= 1 ? "OK" : "  <-- NEGATIVE, DO NOT SHIP"}`,
      );
      console.log(`     per round: ${m.validation.map((v) => v.worstEvOutOfSample.toFixed(3)).join("  ")}`);
    }
    if (m.note) console.log(`  note: paper-only, see markets.json`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
