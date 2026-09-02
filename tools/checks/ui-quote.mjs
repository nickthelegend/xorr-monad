/**
 * Recompute a quote from what the console displayed, using the same pricing kernel the
 * chain uses, and check the UI's number matches.
 *
 * Usage: node tools/checks/ui-quote.mjs <marketKey> <tier> <spot> <low> <high>
 */
const { CALIBRATED_MARKETS } = await import("../../packages/sdk/src/generated/markets.ts");
const { quote } = await import("../../packages/sdk/src/pricing.ts");

const [key, tierStr, spotStr, lowStr, highStr] = process.argv.slice(2);
const tier = Number(tierStr);
const to8 = (s) => {
  const [w, d = ""] = s.replace(/,/g, "").split(".");
  return BigInt(w) * 100_000_000n + BigInt((d + "00000000").slice(0, 8));
};

const m = CALIBRATED_MARKETS.find((x) => x.key === key);
const r = m.rounds[tier];
const spot = to8(spotStr), low = to8(lowStr), high = to8(highStr);

const q = quote(r.probTable, spot, low, high, r.sigma1e4, 400n);
const capped = q.multiplierBps > r.maxMultiplierBps ? r.maxMultiplierBps : q.multiplierBps;

console.log(`market      ${key} tier ${tier} (${r.blocks} blocks / ${r.seconds}s)`);
console.log(`spot        ${spotStr}`);
console.log(`band        ${lowStr} .. ${highStr}`);
console.log(`sigma1e4    ${r.sigma1e4}`);
console.log(`prob        ${(Number(q.prob1e6) / 1e4).toFixed(1)}%`);
console.log(`multiplier  ${(Number(capped) / 1e4).toFixed(2)}x   (${capped} bps)`);
