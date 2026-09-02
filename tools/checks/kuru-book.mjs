/**
 * Does XORR's oracle really read Kuru's order book, and does it refuse a thin one?
 *
 * Checks the claim rather than the code: reads the deployed Kuru MON-AUSD market
 * directly, reads it again through XORR's KuruOracle, and asserts they agree. Then
 * tightens the spread guard below the book's actual spread and asserts the oracle stops
 * reporting a price — because an integration that cannot say "no" is not a safe one.
 *
 * Usage: pnpm check:kuru
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);
const OWNER_PK =
  process.env.PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const root = fileURLToPath(new URL("../../packages/contracts/", import.meta.url));
const deployment = JSON.parse(readFileSync(`${root}deployments/${CHAIN_ID}.json`, "utf8"));

if (!deployment.kuruOracle || !deployment.kuruBook) {
  console.error(
    "No Kuru oracle in this deployment.\n" +
      "Deploy with KURU_MON_AUSD set:\n" +
      "  KURU_MON_AUSD=0x131a2e70a5b31a517a74b8c567149bc294470da9 pnpm deploy:local",
  );
  process.exit(1);
}

const { abi: KuruOracleAbi } = JSON.parse(
  readFileSync(`${root}out/KuruOracle.sol/KuruOracle.json`, "utf8"),
);

const BOOK_ABI = [
  {
    name: "bestBidAsk",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "bid", type: "uint256" },
      { name: "ask", type: "uint256" },
    ],
  },
];

/** keccak256("MON-USD") */
const MON = "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62";

const chain = defineChain({
  id: CHAIN_ID,
  name: "monad-local",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({
  account: privateKeyToAccount(OWNER_PK),
  chain,
  transport: http(RPC),
});

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};

console.log(`Kuru book  ${deployment.kuruBook}`);
console.log(`XORR oracle ${deployment.kuruOracle}\n`);

// ---- the venue, read directly
const [bid, ask] = await pub.readContract({
  address: deployment.kuruBook,
  abi: BOOK_ABI,
  functionName: "bestBidAsk",
});
const venueBid = Number(bid) / 1e18;
const venueAsk = Number(ask) / 1e18;
const venueMid = (venueBid + venueAsk) / 2;
console.log(
  `venue     bid ${venueBid.toFixed(6)}  ask ${venueAsk.toFixed(6)}  mid ${venueMid.toFixed(6)}`,
);

// ---- the same book, through XORR
const [b8, a8, m8, spreadBps] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "quoteTop",
  args: [MON],
});
console.log(
  `oracle    bid ${(Number(b8) / 1e8).toFixed(6)}  ask ${(Number(a8) / 1e8).toFixed(6)}  ` +
    `mid ${(Number(m8) / 1e8).toFixed(6)}  spread ${spreadBps} bps\n`,
);

check(Number(b8) === Math.floor(Number(bid) / 1e10), "oracle's bid is the venue's bid");
check(Number(a8) === Math.floor(Number(ask) / 1e10), "oracle's ask is the venue's ask");

// Which rule this book is marked on comes from the book's own configuration, not from
// comparing the two marks — when the dust guard fires they are equal, and inferring
// "midpoint" from that would report the guard as a design choice.
const [, , , minDepth, , markEnum] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "books",
  args: [MON],
});
const [mid8, micro8, topBid, topAsk] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "marks",
  args: [MON],
});
const [price] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "latest",
  args: [MON],
});

/** Sizes at a precision where dust does not round to zero — dust is the point here. */
const size = (raw) => {
  const v = Number(raw) / 1e10;
  return v !== 0 && v < 0.1 ? v.toPrecision(2) : v.toFixed(1);
};

const configuredMicro = markEnum === 1;
// KuruOracle refuses to weight against a side under a twentieth of the depth floor.
const dustFloor = minDepth / 20n;
const guarded = configuredMicro && dustFloor > 0n && (topBid < dustFloor || topAsk < dustFloor);

console.log(
  `marks     mid ${(Number(mid8) / 1e8).toFixed(6)}  micro ${(Number(micro8) / 1e8).toFixed(6)}  ` +
    `sizes ${size(topBid)} bid / ${size(topAsk)} ask` +
    `\n          configured ${configuredMicro ? "MICRO" : "MID"}` +
    (guarded ? `, guarded to the midpoint (floor ${size(dustFloor)} MON)` : "") +
    `\n`,
);

if (!configuredMicro) {
  check(price === mid8, "the market settles on the midpoint, as configured", `${price}`);
} else if (guarded) {
  /**
   * The guard is the interesting case, so assert it rather than accept either answer:
   * with a side this thin the mark must be the plain midpoint, because weighting
   * against dust would let a fraction of a MON set the price the market settles on.
   */
  check(price === mid8, "a dust side cannot set the mark — it falls back to the midpoint", `${price}`);
  check(micro8 === mid8, "and marks() reports the same fallback the market settles on");
} else {
  check(price === micro8, "the market settles on the microprice, as configured", `${price}`);
  check(price > mid8 === topBid > topAsk, "the mark leans toward the thinner side");
  check(price > b8 && price < a8, "and stays strictly inside the spread");
}

// ---- depth decodes into a real ladder
const [blockNumber, bidPx, bidSz, askPx] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "depth",
  args: [MON, 4],
});
check(blockNumber > 0n, "depth carries the block it was read at", `${blockNumber}`);
check(bidPx[0] > bidPx[1] && bidPx[1] > 0n, "bids descend");
check(askPx[0] > bidPx[0], "the top ask sits above the top bid");
check(bidSz[0] > 0n, "there is size behind the touch", `${Number(bidSz[0]) / 1e10} MON`);

// ---- and the part that matters: it can say no
const tighten = async (bps) => {
  const hash = await wallet.writeContract({
    address: deployment.kuruOracle,
    abi: KuruOracleAbi,
    functionName: "setBook",
    args: [MON, deployment.kuruBook, bps, true],
  });
  await pub.waitForTransactionReceipt({ hash });
};

const guard = Number(spreadBps) > 1 ? Number(spreadBps) - 1 : 1;
await tighten(guard);
const [refused] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "latest",
  args: [MON],
});
check(
  refused === 0n,
  `a spread guard below the real spread reports NO price`,
  `guard ${guard} bps < actual ${spreadBps} bps`,
);

await tighten(500);
const [restored] = await pub.readContract({
  address: deployment.kuruOracle,
  abi: KuruOracleAbi,
  functionName: "latest",
  args: [MON],
});
check(restored > 0n, "and reports it again once the guard is restored", `${restored}`);

console.log(
  failed === 0
    ? "\nPASS: the MON price is Kuru's book, and a book too thin to trust returns nothing"
    : `\nFAIL: ${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
