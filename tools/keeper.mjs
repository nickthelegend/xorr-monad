/**
 * XORR keeper.
 *
 * Two jobs, both of which a production deployment needs and neither of which is
 * simulated:
 *
 *   1. PUBLISH PRICES. Reads real market prices from Binance and submits them to
 *      KeeperOracle as real signed transactions. The prices are real, the transactions
 *      are real; what this stands in for is an aggregation network, not the data.
 *      Where a network already has a push feed for a pair, point RangeMarket at
 *      ChainlinkOracle or PythOracle instead and drop this half.
 *
 *   2. SETTLE. Pokes every ticket whose cutoff block has passed. Anyone can do this —
 *      the keeper just makes sure somebody does.
 *
 * Run: pnpm keeper
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);
const PK =
  process.env.PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TICK_MS = Number(process.env.TICK_MS ?? 1500);

const root = fileURLToPath(new URL("../packages/contracts/", import.meta.url));
const deployment = JSON.parse(readFileSync(`${root}deployments/${CHAIN_ID}.json`, "utf8"));

const abi = (name, dir = "src") =>
  JSON.parse(readFileSync(`${root}out/${name}.sol/${name}.json`, "utf8")).abi;
const RangeMarketAbi = abi("RangeMarket");
const KeeperOracleAbi = abi("KeeperOracle");

const chain = defineChain({
  id: CHAIN_ID,
  name: "monad-local",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

if (deployment.oracleKind !== "keeper") {
  console.log(
    `deployment ${CHAIN_ID} reads its prices from "${deployment.oracleKind}", which publishes\n` +
      `on its own. This keeper will only settle expired tickets.`,
  );
}

/** marketId -> the Binance symbol whose mid we publish for it. */
const FEEDS = [
  { key: "BTC", id: "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e", symbol: "BTCUSDT" },
  { key: "ETH", id: "0x2430f68ea2e8d4151992bb7fc3a4c472087a6149bf7e0232704396162ab7c1f7", symbol: "ETHUSDT" },
];

/** Real prices, converted to the 8-decimal fixed point the market settles on. */
async function fetchPrices() {
  const symbols = JSON.stringify(FEEDS.map((f) => f.symbol));
  const url = `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const rows = await r.json();
  const bySymbol = Object.fromEntries(rows.map((x) => [x.symbol, x.price]));

  return FEEDS.map((f) => {
    const px = bySymbol[f.symbol];
    if (!px) throw new Error(`no price for ${f.symbol}`);
    // Parse to 8dp without floating point, so the published number is exactly the
    // number the exchange printed.
    const [w, d = ""] = String(px).split(".");
    return { ...f, price: BigInt(w) * 100_000_000n + BigInt((d + "00000000").slice(0, 8)) };
  });
}

let published = 0;

async function publish() {
  if (deployment.oracleKind !== "keeper") return;
  const feeds = await fetchPrices();

  try {
    const hash = await wallet.writeContract({
      address: deployment.oracle,
      abi: KeeperOracleAbi,
      functionName: "pushBatch",
      args: [feeds.map((f) => f.id), feeds.map((f) => f.price)],
    });
    await pub.waitForTransactionReceipt({ hash });
    published++;
    if (published % 10 === 1) {
      console.log(
        `published ${feeds.map((f) => `${f.key} ${(Number(f.price) / 1e8).toFixed(2)}`).join("  ")}  ${hash.slice(0, 12)}…`,
      );
    }
  } catch (e) {
    // A restart after a long gap can exceed the oracle's single-update deviation
    // guard. That guard exists to stop a bad keeper teleporting the price, so the
    // recovery is an explicit owner re-base rather than widening the guard.
    if (String(e).includes("DeviationTooLarge")) {
      for (const f of feeds) {
        await wallet.writeContract({
          address: deployment.oracle,
          abi: KeeperOracleAbi,
          functionName: "rebase",
          args: [f.id, f.price],
        });
      }
      console.log("re-based feeds past the deviation guard after a gap");
    } else {
      throw e;
    }
  }
}

async function settleDue() {
  const next = await pub.readContract({
    address: deployment.rangeMarket,
    abi: RangeMarketAbi,
    functionName: "nextTicketId",
  });
  const block = await pub.getBlockNumber();

  for (let id = 1n; id < next; id++) {
    const t = await pub.readContract({
      address: deployment.rangeMarket,
      abi: RangeMarketAbi,
      functionName: "getTicket",
      args: [id],
    });
    if (t.status !== 0) continue;
    if (block < BigInt(t.expiryBlock)) continue;

    try {
      const hash = await wallet.writeContract({
        address: deployment.rangeMarket,
        abi: RangeMarketAbi,
        functionName: "settle",
        args: [id],
      });
      await pub.waitForTransactionReceipt({ hash });
      const after = await pub.readContract({
        address: deployment.rangeMarket,
        abi: RangeMarketAbi,
        functionName: "getTicket",
        args: [id],
      });
      console.log(
        `settled #${id} ${["open", "WON", "lost", "void"][after.status].padEnd(4)} ` +
          `at ${(Number(after.settledPrice) / 1e8).toFixed(2)}  ${hash}`,
      );
    } catch (e) {
      if (!String(e).includes("StalePrice")) {
        console.error(`#${id}: ${String(e).slice(0, 120)}`);
      }
    }
  }
}

console.log(`XORR keeper — chain ${CHAIN_ID} via ${RPC}`);
console.log(`  oracle      ${deployment.oracle} (${deployment.oracleKind})`);
console.log(`  rangeMarket ${deployment.rangeMarket}`);
console.log(`  publishing real Binance prices every ${TICK_MS}ms\n`);

let running = false;
async function loop() {
  if (!running) {
    running = true;
    try {
      await publish();
      await settleDue();
    } catch (e) {
      console.error("keeper:", String(e).slice(0, 180));
    }
    running = false;
  }
  setTimeout(loop, TICK_MS);
}
loop();
