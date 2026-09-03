/**
 * XORR keeper.
 *
 * Three jobs, all of which a production deployment needs and none of which is
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
 *   3. RE-MARK. Refits volatility from recent tape and pushes it on-chain via
 *      RangeMarket.setRoundConfigs.
 *
 *      This is the operational half of the pricing. Sigma is deliberately estimated at
 *      the quiet end of recent windows, which is what keeps the vault solvent through a
 *      regime change — and it is also what makes the spread much wider than the 4% fee.
 *      A calibration fixed at deploy time has to hedge against every regime the market
 *      might enter next; one that re-marks only has to cover the drift since the last
 *      mark. Re-marking often is therefore not an optimisation, it is how the spread
 *      gets narrower without the vault getting thinner.
 *
 *      The estimator is imported from the SDK rather than reimplemented here. A keeper
 *      carrying its own copy of this arithmetic would be a solvency bug waiting for
 *      someone to edit one of them.
 *
 * Run: pnpm keeper
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { remarkSigmas1e4 } from "../packages/sdk/src/remark.ts";
import { secondCloses } from "../packages/sdk/src/termstructure.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);
const PK =
  process.env.PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TICK_MS = Number(process.env.TICK_MS ?? 1500);
/** How often to refit volatility and push it on-chain. 0 disables re-marking. */
const REMARK_MS = Number(process.env.REMARK_MS ?? 900_000);
/**
 * How often to record the Kuru mark into the oracle's history.
 *
 * The window is three seconds — ten Monad blocks — so a poke every half second gives
 * the average six readings to work with and keeps the newest one comfortably inside the
 * staleness limit. Three seconds is chosen against a real tension rather than picked to
 * sound safe: a longer window dilutes a cutoff-block attack further, but it also makes
 * the settling price lag the market, and a lag longer than the round is an exploit in
 * the other direction — a player who watches the price jump would know the settle has
 * not caught up. Ten blocks is a tenfold cost increase on the attack for a lag well
 * inside even the shortest round.
 */
const POKE_MS = Number(process.env.POKE_MS ?? 500);

/**
 * One JSON object per line.
 *
 * A keeper is watched by things that are not people — a health check, a log drain, a
 * grep in a demo — and "published BTC 77748.00 0x1f2e…" is only readable by the third.
 * The question that actually matters at 3am is "is it still publishing", and that needs
 * a field, not a sentence.
 */
function log(event, fields = {}) {
  process.stdout.write(
    JSON.stringify({ t: new Date().toISOString(), event, ...fields }) + "\n",
  );
}

const root = fileURLToPath(new URL("../packages/contracts/", import.meta.url));
const deployment = JSON.parse(readFileSync(`${root}deployments/${CHAIN_ID}.json`, "utf8"));

/**
 * Publish to the feed, not to the router.
 *
 * With a router deployed, `oracle` is the dispatcher that markets read through — it has
 * no prices of its own. The keeper's prints belong on the push feed behind it. MON is
 * not in this list at all: it is priced from Kuru's order book on-chain, so there is
 * nothing for a keeper to publish.
 */
const FEED = deployment.feedOracle ?? deployment.oracle;
const KURU_ORACLE = deployment.kuruOracle;
/** keccak256("MON-USD") — the market priced from Kuru's book. */
const MON_ID = "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62";

const abi = (name, dir = "src") =>
  JSON.parse(readFileSync(`${root}out/${name}.sol/${name}.json`, "utf8")).abi;
const RangeMarketAbi = abi("RangeMarket");
const KeeperOracleAbi = abi("KeeperOracle");
const KuruOracleAbi = abi("KuruOracle");

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
  log("publish_disabled", {
    oracleKind: deployment.oracleKind,
    note: "this deployment's oracle publishes on its own; only settling expired tickets",
  });
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
      address: FEED,
      abi: KeeperOracleAbi,
      functionName: "pushBatch",
      args: [feeds.map((f) => f.id), feeds.map((f) => f.price)],
    });
    await pub.waitForTransactionReceipt({ hash });
    published++;
    if (published % 10 === 1) {
      log("published", {
        prices: Object.fromEntries(feeds.map((f) => [f.key, Number(f.price) / 1e8])),
        tx: hash,
      });
    }
  } catch (e) {
    // A restart after a long gap can exceed the oracle's single-update deviation
    // guard. That guard exists to stop a bad keeper teleporting the price, so the
    // recovery is an explicit owner re-base rather than widening the guard.
    if (String(e).includes("DeviationTooLarge")) {
      for (const f of feeds) {
        await wallet.writeContract({
          address: FEED,
          abi: KeeperOracleAbi,
          functionName: "rebase",
          args: [f.id, f.price],
        });
      }
      log("rebased", { reason: "deviation guard tripped after a gap", feeds: feeds.map((f) => f.key) });
    } else {
      throw e;
    }
  }
}

/**
 * Refit volatility from recent tape and push it on-chain.
 *
 * Only sigma moves. The measured SHAPE of the distribution — the probability table,
 * including the point mass at zero that makes a three-second round pricable at all —
 * is left exactly as calibrated, because it changes far more slowly than its scale
 * does and refitting it here would mean re-running the walk-forward gate that decides
 * whether a round is solvent at all. That gate belongs in `calibrate-all`, under a
 * human, not in a loop. So `setRoundConfigs` carries the new sigma and the existing
 * floors, which is precisely what the contract documents that function for.
 *
 * A refit that comes back larger than the current mark is published like any other. It
 * is tempting to only ever shade downward, but a rising sigma means the market got
 * louder and the bands must widen to stay solvent — refusing to publish that would be
 * the one direction that actually drains the bankroll.
 */
/**
 * Start the clock at boot rather than at zero.
 *
 * The tables were calibrated at deploy time, so there is nothing to re-mark on the
 * first tick — and doing it anyway meant the keeper's opening move was a 160,000-candle
 * fetch, which is exactly when a demo is being watched.
 */
let lastRemark = Date.now();
let remarking = false;

let remarkDisabled = false;

async function remark() {
  if (REMARK_MS <= 0 || remarking || remarkDisabled) return;
  if (Date.now() - lastRemark < REMARK_MS) return;
  remarking = true;
  lastRemark = Date.now();

  for (const f of FEEDS) {
    let closes;
    try {
      closes = await secondCloses(f.symbol, 160_000);
    } catch (e) {
      log("remark_skipped", { market: f.key, reason: `tape unavailable: ${String(e).slice(0, 120)}` });
      continue;
    }

    const sigmas = remarkSigmas1e4(closes);

    const current = await pub.readContract({
      address: deployment.rangeMarket,
      abi: RangeMarketAbi,
      functionName: "roundConfigs",
      args: [f.id],
    });

    if (current.length !== sigmas.length) {
      log("remark_skipped", {
        market: f.key,
        reason: `chain has ${current.length} rounds, the fit produced ${sigmas.length}`,
      });
      continue;
    }

    // The floors and ceilings are the calibration's, not ours. Only sigma is re-marked.
    const cfgs = current.map((c, i) => ({
      sigma1e4: sigmas[i],
      minProb1e6: c.minProb1e6,
      maxMultiplierBps: c.maxMultiplierBps,
    }));

    const drift = cfgs.map((c, i) =>
      Number(current[i].sigma1e4) === 0
        ? 0
        : +(((c.sigma1e4 - Number(current[i].sigma1e4)) / Number(current[i].sigma1e4)) * 100).toFixed(1),
    );

    try {
      const hash = await wallet.writeContract({
        address: deployment.rangeMarket,
        abi: RangeMarketAbi,
        functionName: "setRoundConfigs",
        args: [f.id, cfgs],
      });
      await pub.waitForTransactionReceipt({ hash });
      log("remarked", {
        market: f.key,
        closes: closes.length,
        sigma1e4: cfgs.map((c) => c.sigma1e4),
        driftPct: drift,
        tx: hash,
      });
    } catch (e) {
      // setRoundConfigs is owner-only. A keeper running on its own key cannot re-mark,
      // which is a deployment choice rather than a fault — say so once, clearly, rather
      // than failing the tick every fifteen minutes.
      const msg = String(e);
      log("remark_failed", {
        market: f.key,
        error: /NotOwner/.test(msg)
          ? "this keeper's account does not own RangeMarket, so it cannot re-mark. Run the keeper on the owner key, or use `pnpm remark`."
          : msg.slice(0, 200),
      });
      if (/NotOwner/.test(msg)) {
        remarkDisabled = true; // a deployment choice, not a transient fault
        remarking = false;
        return;
      }
    }
  }
  remarking = false;
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
      log("settled", {
        ticket: Number(id),
        outcome: ["open", "won", "lost", "void"][after.status],
        price: Number(after.settledPrice) / 1e8,
        tx: hash,
      });
    } catch (e) {
      if (!String(e).includes("StalePrice")) {
        log("settle_failed", { ticket: Number(id), error: String(e).slice(0, 160) });
      }
    }
  }
}

log("start", {
  chainId: CHAIN_ID,
  rpc: RPC,
  oracle: deployment.oracle,
  oracleKind: deployment.oracleKind,
  rangeMarket: deployment.rangeMarket,
  account: account.address,
  tickMs: TICK_MS,
  remarkMs: REMARK_MS,
});

/**
 * Record the Kuru mark on its own clock.
 *
 * Separate from the publish loop because it runs six times as often and must not be
 * held up by a Binance fetch — the value of the average comes from the readings being
 * evenly spaced, and a gap is exactly what the staleness check refuses to average over.
 */
let poking = false;
let pokes = 0;
async function pokeLoop() {
  if (KURU_ORACLE && !poking) {
    poking = true;
    try {
      const hash = await wallet.writeContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "poke",
        args: [MON_ID],
      });
      await pub.waitForTransactionReceipt({ hash });
      pokes++;
      if (pokes % 60 === 1) log("poked", { market: "MON", pokes });
    } catch (e) {
      if (pokes % 60 === 1) log("poke_failed", { error: String(e).slice(0, 160) });
      pokes++;
    }
    poking = false;
  }
  setTimeout(pokeLoop, POKE_MS);
}
if (KURU_ORACLE) pokeLoop();

let running = false;
async function loop() {
  if (!running) {
    running = true;
    try {
      await publish();
      await settleDue();
      /**
       * Deliberately not awaited. Re-marking pulls 160,000 candles per market, which
       * takes the better part of a minute — long enough that awaiting it here stalls
       * the 1.5-second publish loop and the price on the desk visibly freezes. It
       * guards its own re-entry, so letting it run alongside is safe.
       */
      void remark().catch((e) => log("remark_failed", { error: String(e).slice(0, 200) }));
    } catch (e) {
      log("tick_failed", { error: String(e).slice(0, 200) });
    }
    running = false;
  }
  setTimeout(loop, TICK_MS);
}
loop();
