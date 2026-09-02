/**
 * How conservative should sigma be?
 *
 * Pricing off the calmest recent window is safe but charges a punitive spread; pricing
 * off the latest window is fair on average but flips to losing whenever volatility
 * falls. This sweeps the percentile in between and reports, for each, the realised
 * return per unit staked against held-out tape.
 */
const { ROUND_BLOCKS, secondCloses, sigmaOver, empiricalProb, tierSeconds } =
  await import("../../packages/sdk/src/termstructure.ts");

function buildTable(closes, seconds, sigma) {
  let prev = 0;
  return Array.from({ length: 17 }, (_, i) => {
    const p = empiricalProb(closes, seconds, i * 0.25 * sigma);
    return (prev = Math.min(1, Math.max(prev, p)));
  });
}

function sigmaAtPercentile(window, seconds, sub, pct) {
  const stride = Math.max(1, Math.floor(sub / 4));
  const xs = [];
  for (let s = 0; s + sub <= window.length; s += stride) {
    const v = sigmaOver(window.slice(s, s + sub), seconds);
    if (v > 0) xs.push(v);
  }
  if (!xs.length) return sigmaOver(window, seconds);
  xs.sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor((pct / 100) * xs.length))];
}

const closes = await secondCloses("BTCUSDT", 60_000);
const TEST = 15_000;
const fit = closes.slice(0, closes.length - TEST);
const test = closes.slice(-TEST);

console.log("pct   " + [0, 2, 4].map((t) => (tierSeconds(ROUND_BLOCKS[t]) + "s").padStart(9)).join("") + "   worst");
for (const pct of [0, 10, 20, 30, 40, 50, 65]) {
  const row = [];
  for (const tier of [0, 2, 4]) {
    const secs = tierSeconds(ROUND_BLOCKS[tier]);
    const table = buildTable(fit, secs, sigmaOver(fit, secs));
    const sigma = sigmaAtPercentile(fit, secs, Math.max(600, secs * 10), pct);

    let staked = 0, returned = 0;
    for (let z = 0.3; z <= 2.5; z += 0.1) {
      const i = Math.floor(z / 0.25);
      const p = table[i] + (table[i + 1] - table[i]) * ((z - i * 0.25) / 0.25);
      if (p < 0.125) continue;
      let mult = 0.96 / p;
      if (mult < 1.2) continue;
      if (mult > 8) mult = 8;
      const real = empiricalProb(test, secs, z * sigma);
      staked += 1;
      returned += real * mult;
    }
    row.push(staked ? returned / staked : NaN);
  }
  const worst = Math.max(...row);
  console.log(
    `${String(pct).padStart(3)}   ` +
      row.map((r) => r.toFixed(3).padStart(9)).join("") +
      `   ${worst.toFixed(3)} ${worst <= 0.99 ? "safe" : "LOSES"}`,
  );
}
console.log("\n(values are paid/staked — below 1.00 is vault-positive; 0.96 would be the bare fee)");
