# XORR — what was built, and what is actually true about it

A handheld console for trading price ranges, built for Monad's 300ms blocks.

## The one-sentence version

Paint a band around the price, pick a cutoff a few seconds out, and get paid a
multiplier if the price prints inside it — priced off a distribution **measured** from
real market tape rather than an assumed bell curve, because over a three-second round
the price often does not move at all and a bell curve says that cannot happen.

## Why it needs this chain

A three-second round is ten blocks. The cutoff is a block number, not a timer, so
settlement is a fact rather than a promise. On a two-second chain the round does not
exist; on a twelve-second chain it is a coin flip with extra steps. Everything about the
product — the pace, the stacking, the fact that the demo desk feels like an arcade
cabinet — falls out of the block time.

## The technical claim worth checking

**The distribution is measured, and the two implementations agree exactly.**

Each round length carries its own probability table, sampled on a 0.25σ grid from real
one-second tape and stored on-chain. `Pricing.sol` interpolates it; `packages/sdk`
mirrors it. Every test run diffs **1,728 quotes** across markets, rounds and widths, and
requires them identical — so the number a player sees on the demo desk is the number the
contract will charge.

The measured table matters concretely. `test_NormalOverpaysAgainstAMeasuredShortRound`
prices the same band both ways and shows the normal-distribution version is negative
expected value for the vault. `T(0)` — the probability of no movement at all over a
three-second BTC round — is a large fraction, and a normal puts it at zero.

## What is real

- **Prices** — live Binance one-second tape; MON marks against Kuru's on-chain book
- **Stablecoin** — Agora AUSD, the real token, funded on a mainnet fork from a real holder
- **Transactions** — real signed fires and settles at 300ms
- **Leaderboard** — aggregated from settlement events; empty when nobody has settled
- **Demo desk** — replays real returns through the same pricing kernel as the chain

No mocks ship. The single test double lives under `test/helpers/` and is unreachable
from `src/` or any deploy script.

## Three things that are deliberately unflattering

**1. The spread is much wider than the 4% fee.** Volatility moves faster than any fixed
calibration. Fitting on the immediately preceding window errs in both directions —
measured on held-out tape, an unshaded fit ran between +5% and −25% per round depending
purely on which way the regime moved. So the modelled chance is estimated off the
quieter end of recent behaviour and the win-rate table is quoted at the high end of it,
which buys a one-sided solvency guarantee at real cost: replayed across four disjoint
stretches of held-out tape the realised edge measured between about 3% and about 42%,
driven far more by the volatility of the stretch than by the round length. That is a
worse deal for a player than the fee implies, it is stated in the app rather than only
here, and `tools/checks/paper-calibration.mjs` sweeps all four windows and fails if any
round length turns player-positive on any of them — or quotes nothing at all.

Closing that gap is the honest next step, and it is an operational one rather than a
modelling trick: re-mark sigma on-chain far more often than once per deployment, so the
model tracks the regime instead of hedging against it. `pnpm remark` is the mechanism;
the keeper should drive it.

**2. No win percentage is shown on the deck.** The model's probability is deliberately
optimistic — that bias *is* the house edge. Printing it next to the multiplier would
present a pricing input as a forecast. The multiplier is the contract; that is what is
shown.

**3. MON is paper-only.** There is no second-resolution tape for MON anywhere public, so
it borrows BTC's dynamics for the demo desk and is not fundable. The app says so.

## Safety properties, and the tests that hold them

| Property | Test |
|---|---|
| The vault can pay every open ticket even if all win | `test_VaultCanAlwaysPayEveryOpenTicketEvenIfAllWin` — fires 20, wins 20, pays 20 |
| Reserved never exceeds assets, for any input | `testFuzz_ReservedNeverExceedsAssets` |
| No legal band is ever positive-EV for the player | `testFuzz_ExpectedValueIsAlwaysBelowOne` |
| Stacking a now-certain band is refused | `test_StackingASureThingAtTheCutoffIsRefused` |
| A stale print blocks settlement rather than settling wrong | `test_StalePrintInsideTheWindowAsksTheKeeperToTryAgain` |
| A dead feed voids and refunds in full | `test_DeadFeedPastTheWindowVoidsAndRefunds` |
| A room's pot always closes out to zero | `testFuzz_PotAlwaysClosesOut` |
| A compromised keeper cannot teleport the price | `test_DeviationGuardRejectsATeleport` |

The vault reserves the **full payout** at open, not the expected profit. That is the
difference between a bankroll that survives a lucky streak and one that does not.

## Bugs the verification pass found and closed

Each of these was found by testing the running product, not by reading the code.

- **The band painter offered bands the market refused.** Deriving a half-width from a
  z-score truncates twice, so the tightest band the UI allowed came back one unit under
  the probability floor — drag the rules to the stop and the market rejected the band it
  had just offered. Both ends are now solved by bisection against the same arithmetic
  `fire` uses.
- **Firing raced the market.** A band a few basis points wide, centred on the spot the
  client last read, was frequently already off-centre by the time the transaction
  landed. `fireBand` takes the band's *shape* and centres it at execution. A test proves
  the absolute-endpoint path really does lose that race.
- **The desk reported success for reverted transactions.** A reverted transaction still
  produces a receipt, so awaiting one proved only that the chain saw it. Fires now
  simulate first (which turns a revert into a named error) and check receipt status.
- **A zero-width band was sellable.** Where the measured point mass at zero exceeded the
  probability floor, a band of no width priced at several times the stake on an event
  that happens a quarter of the time. The floor now sits above the point mass.
- **The demo desk delivered odds it did not quote.** It drew from a normal walk while
  pricing off the measured distribution: rounds advertised at 76% paid out 31%. It now
  replays real one-second returns, so realised frequency matches the model by
  construction.
- **The leaderboard was invented.** Seven fictional players with fictional P&L. It now
  aggregates real settlement events and shows an empty board when nobody has settled.
- **The hero silently rendered nothing.** The GLTF loader pulls decoders from a CDN;
  where that is unreachable Suspense never resolves and the canvas stays blank with no
  error. The console is procedural, so it is now built in-process from a shared
  definition — the `.glb` is still emitted as an artifact.
- **A dead node produced a misleading error.** Clients map RPC error codes onto canned
  text, so an unreachable node surfaced as "missing or invalid parameters". The desk now
  shows the real reason and never invents a price.

## Layout

```
packages/contracts   RangeMarket, RoomMarket, XorrVault, oracle adapters
packages/sdk         Pricing kernel, paper engine, calibration, console geometry
apps/web             Next.js console + /api/price, /api/leaderboard, /api/rpc
tools                Keeper, model generator, verification checks
```

104 Solidity tests, 33 TypeScript tests, 1,728 cross-implementation quotes.
`docs/TEST-PLAN.md` is the plan every component was verified against.
