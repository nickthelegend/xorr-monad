import { createPublicClient, defineChain, http } from "viem";
const { CALIBRATED_MARKETS } = await import("../../packages/sdk/src/generated/markets.ts");
const { quote, bandLimits } = await import("../../packages/sdk/src/pricing.ts");
const { RangeMarketAbi } = await import("../../packages/sdk/src/generated/abis.ts");

// Read the live deployment rather than pinning an address, so this check can never
// silently compare the SDK against a contract that is no longer the one in use.
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const deployment = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../packages/contracts/deployments/143.json", import.meta.url)), "utf8"),
);
const RANGE = deployment.rangeMarket;
const chain = defineChain({ id:143, name:"m", nativeCurrency:{name:"MON",symbol:"MON",decimals:18}, rpcUrls:{default:{http:["http://127.0.0.1:8545"]}} });
const pub = createPublicClient({ chain, transport: http("http://127.0.0.1:8545") });

let allMatch = true;
for (const m of CALIBRATED_MARKETS.filter(x => x.live)) {
  for (const tier of [0, 2, 5]) {
    const r = m.rounds[tier];
    const [spot, sig, maxH, minH] = await pub.readContract({ address: RANGE, abi: RangeMarketAbi, functionName: "bandLimits", args: [m.marketId, tier] });
    const l = bandLimits(r.probTable, spot, r.sigma1e4, 400n, 12_000n, r.minProb1e6);

    const half = (spot * ((maxH + minH) / 2n)) / 100_000_000n;
    const low = spot - half, high = spot + half;
    const [onMult, onProb] = await pub.readContract({ address: RANGE, abi: RangeMarketAbi, functionName: "quote", args: [m.marketId, low, high, tier] });
    const off = quote(r.probTable, spot, low, high, r.sigma1e4, 400n);

    const ok = sig === r.sigma1e4 && maxH === l.maxHalfWidth1e4 && minH === l.minHalfWidth1e4
            && onMult === off.multiplierBps && onProb === off.prob1e6;
    if (!ok) allMatch = false;
    console.log(`${m.key} t${tier} spot=${(Number(spot)/1e8).toFixed(2)} sigma=${sig}/${r.sigma1e4} maxH=${maxH}/${l.maxHalfWidth1e4} minH=${minH}/${l.minHalfWidth1e4} mult=${onMult}/${off.multiplierBps} prob=${onProb}/${off.prob1e6} ${ok?"MATCH":"*** MISMATCH ***"}`);
  }
}
console.log(allMatch ? "\nB-5 PASS: chain and SDK agree exactly on every checked market/tier" : "\nB-5 FAIL");
process.exit(allMatch ? 0 : 1);
