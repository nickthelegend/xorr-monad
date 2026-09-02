/**
 * What does the demo desk actually pay, against real tape?
 *
 * Fires many rounds through the paper engine while the feed replays real one-second
 * BTC returns, and measures the realised return per unit staked.
 *
 * The property that must hold is NOT "realised win rate equals the model's
 * probability". It deliberately does not: sigma is shaded 0.85x so the vault survives
 * a volatility regime change, which makes the model's probability optimistic on
 * purpose. That bias is the house edge, and it is why no win percentage is shown on
 * the deck.
 *
 * What must hold is that the edge runs in the vault's favour at every round length.
 * A round where players come out ahead against real tape is a round that drains the
 * bankroll.
 */
const { PaperEngine, PaperFeed } = await import("../../packages/sdk/src/engine.ts");
const { MARKETS } = await import("../../packages/sdk/src/markets.ts");

const BTC = MARKETS.find((m) => m.key === "BTC");
const SPOT = 77_000_00000000n;
const ROUNDS = 3000;

/**
 * Where in the tape to start replaying.
 *
 * The three-second round has come out player-positive on one stretch of tape and
 * comfortably vault-positive on another, which is the whole risk: an edge measured on
 * a single window says nothing about the regime the market is actually in. Sweeping
 * the start offset walks the same tables across disjoint stretches, and every one of
 * them has to hold.
 */
const OFFSETS = process.env.REPLAY_OFFSET
  ? [Number(process.env.REPLAY_OFFSET)]
  : [0, 12_000, 24_000, 36_000];

/** Real one-second closes — the same tape the pricing tables were measured on. */
async function realReturns(symbol, want) {
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
  const rs = [];
  for (let i = 1; i < closes.length; i++) rs.push(Math.log(closes[i] / closes[i - 1]));
  return rs;
}

const RETURNS = await realReturns("BTCUSDT", 60_000);
console.log(`replaying ${RETURNS.length} real one-second BTC returns\n`);

let anyBad = false;
const worst = new Map();

for (const OFFSET of OFFSETS) {
console.log(`\nreplay starting ${OFFSET} seconds into the tape`);
console.log("tier  round   model%   realised%   paid/staked   edge     verdict");
console.log("-".repeat(70));

for (let tier = 0; tier < BTC.rounds.length; tier++) {
  const r = BTC.rounds[tier];
  const engine = new PaperEngine({ startingBalance: 10n ** 15n, vaultAssets: 10n ** 18n });
  const feed = new PaperFeed(BTC, SPOT, RETURNS, (tier * 977 + OFFSET) % Math.max(1, RETURNS.length - 1));

  const limits = engine.limitsFor(BTC, tier, SPOT);
  const half = (limits.minHalfWidth1e4 + limits.maxHalfWidth1e4) / 2n;

  let wins = 0, n = 0, quoted = 0, staked = 0n, returned = 0n;
  for (let i = 0; i < ROUNDS; i++) {
    const spot = feed.price;
    const low = spot - (spot * half) / 100_000_000n;
    const high = spot + (spot * half) / 100_000_000n;

    const res = engine.fire(BTC, spot, low, high, 1_000_000n, tier);
    if (!res.ok) { for (let b = 0; b < r.blocks; b++) feed.step(); engine.tick(feed.price); continue; }
    quoted += Number(res.ticket.prob1e6) / 1e6;
    staked += res.ticket.stake;

    for (let b = 0; b < r.blocks; b++) engine.tick(feed.step());
    if (res.ticket.status === "won") {
      wins++;
      returned += res.ticket.payout;
    }
    n++;
  }

  /**
   * A round that quotes nothing is a failure, not a pass.
   *
   * Dividing by n here yields NaN when the desk refused every ticket, and NaN > 1 is
   * false — so a round the player cannot actually buy used to print "vault +" and let
   * the whole check succeed. The safest possible book is the one with no book, and it
   * is not what this is measuring.
   */
  if (n === 0) {
    anyBad = true;
    console.log(
      `${String(tier).padStart(4)}  ${(r.seconds + "s").padStart(6)}  ` +
        `${"—".padStart(6)}  ${"—".padStart(9)}   ${"—".padStart(11)}   ` +
        `${"—".padStart(7)}  *** QUOTED NOTHING ***`,
    );
    continue;
  }

  const realised = wins / n;
  const q = quoted / n;
  const ratio = Number(returned) / Number(staked);
  const edge = 1 - ratio;
  const bad = ratio > 1; // players ahead against real tape drains the bankroll
  if (bad) anyBad = true;
  console.log(
    `${String(tier).padStart(4)}  ${(r.seconds + "s").padStart(6)}  ${(q * 100).toFixed(1).padStart(6)}  ` +
      `${(realised * 100).toFixed(1).padStart(9)}   ${ratio.toFixed(4).padStart(11)}   ` +
      `${(edge * 100).toFixed(2).padStart(6)}%  ${bad ? "*** VAULT LOSES ***" : "vault +"}`,
  );
  const prev = worst.get(tier);
  if (!prev || edge < prev.edge) worst.set(tier, { edge, offset: OFFSET, round: r.seconds });
}
}

console.log("\nthinnest edge each round showed across every window");
console.log("-".repeat(70));
for (const [tier, w] of [...worst.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(
    `${String(tier).padStart(4)}  ${(w.round + "s").padStart(6)}  ` +
      `${(w.edge * 100).toFixed(2).padStart(7)}%  at offset ${w.offset}`,
  );
}

console.log(
  anyBad
    ? "\nFAIL: a round pays players more than they stake, or quotes nothing at all"
    : `\nPASS: every round length is vault-positive on all ${OFFSETS.length} windows of real tape`,
);
process.exit(anyBad ? 1 : 0);
