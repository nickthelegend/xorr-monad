/**
 * Does the deployed contract price the way the SDK prices?
 *
 * The invariant is about the KERNEL, not about a frozen number. Sigma is re-marked
 * on-chain by the keeper as volatility drifts — that is the whole point of
 * `setRoundConfigs` — so asserting that the chain's sigma still equals the value in the
 * generated tables would fail every time the operational half of the system did its
 * job, and would have to be silenced rather than believed.
 *
 * So: read whatever sigma the chain is actually using, feed that to the SDK, and
 * require the band limits, the multiplier and the probability to agree exactly. Drift
 * from the calibrated value is reported alongside, because it is worth seeing, but it
 * is information rather than a failure.
 */
import { createPublicClient, defineChain, http } from "viem";
const { CALIBRATED_MARKETS } = await import("../../packages/sdk/src/generated/markets.ts");
const { quote, bandLimits } = await import("../../packages/sdk/src/pricing.ts");
const { RangeMarketAbi } = await import("../../packages/sdk/src/generated/abis.ts");

const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);

// Read the live deployment rather than pinning an address, so this check can never
// silently compare the SDK against a contract that is no longer the one in use.
let deployment;
try {
  deployment = JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../packages/contracts/deployments/${CHAIN_ID}.json`, import.meta.url)),
      "utf8",
    ),
  );
} catch {
  console.error(`No deployment for chain ${CHAIN_ID}. Bring one up with \`pnpm demo\`.`);
  process.exit(1);
}

const RANGE = deployment.rangeMarket;
const chain = defineChain({
  id: CHAIN_ID,
  name: "monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });

try {
  await pub.getBlockNumber();
} catch {
  console.error(`No chain at ${RPC}. Bring one up with \`pnpm demo\`.`);
  process.exit(1);
}

let allMatch = true;
let anyDrift = false;

for (const m of CALIBRATED_MARKETS.filter((x) => x.live)) {
  for (const tier of [0, 2, 5]) {
    const r = m.rounds[tier];

    let spot, sig, maxH, minH, onMult, onProb;
    try {
      [spot, sig, maxH, minH] = await pub.readContract({
        address: RANGE,
        abi: RangeMarketAbi,
        functionName: "bandLimits",
        args: [m.marketId, tier],
      });

      const half = (spot * ((maxH + minH) / 2n)) / 100_000_000n;
      [onMult, onProb] = await pub.readContract({
        address: RANGE,
        abi: RangeMarketAbi,
        functionName: "quote",
        args: [m.marketId, spot - half, spot + half, tier],
      });
    } catch (e) {
      /**
       * A stale price is the contract refusing to quote, which is correct behaviour and
       * a completely different situation from the two implementations disagreeing. Say
       * which one it is instead of surfacing a client-library stack trace.
       */
      const msg = String(e);
      if (/StalePrice/.test(msg)) {
        console.error(
          `\n${m.key} t${tier}: the market refused to quote because its price is stale.\n` +
            `That is the staleness guard working, not a parity failure — the keeper has\n` +
            `stopped publishing. Check \`curl -s localhost:3000/api/health\`.`,
        );
        process.exit(2);
      }
      console.error(`\n${m.key} t${tier}: ${msg.split("\n")[0]}`);
      process.exit(1);
    }

    // Price the SDK side with the sigma the CHAIN is using, not the calibrated one.
    const l = bandLimits(r.probTable, spot, sig, 400n, 12_000n, r.minProb1e6);
    const half = (spot * ((maxH + minH) / 2n)) / 100_000_000n;
    const off = quote(r.probTable, spot, spot - half, spot + half, sig, 400n);

    const ok =
      maxH === l.maxHalfWidth1e4 &&
      minH === l.minHalfWidth1e4 &&
      onMult === off.multiplierBps &&
      onProb === off.prob1e6;
    if (!ok) allMatch = false;

    const driftPct =
      r.sigma1e4 === 0n ? 0 : (Number(sig - r.sigma1e4) / Number(r.sigma1e4)) * 100;
    if (Math.abs(driftPct) > 0.05) anyDrift = true;

    console.log(
      `${m.key} t${tier} spot=${(Number(spot) / 1e8).toFixed(2)} sigma=${sig}` +
        `${Math.abs(driftPct) > 0.05 ? ` (re-marked ${driftPct > 0 ? "+" : ""}${driftPct.toFixed(1)}% vs calibrated ${r.sigma1e4})` : ""}` +
        ` maxH=${maxH}/${l.maxHalfWidth1e4} minH=${minH}/${l.minHalfWidth1e4}` +
        ` mult=${onMult}/${off.multiplierBps} prob=${onProb}/${off.prob1e6} ${ok ? "MATCH" : "*** MISMATCH ***"}`,
    );
  }
}

if (anyDrift) {
  console.log(
    "\nSigma on-chain differs from the generated tables because the keeper has re-marked\n" +
      "it. That is the operational half of the pricing working; the kernel comparison above\n" +
      "is what this check is for.",
  );
}
console.log(
  allMatch
    ? "\nB-5 PASS: the deployed contract and the SDK price identically on every checked market/tier"
    : "\nB-5 FAIL",
);
process.exit(allMatch ? 0 : 1);
