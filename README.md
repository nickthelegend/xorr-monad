# XORR

**Built for fun and money.** A handheld console for trading price ranges on Monad.

You paint a band around the price, pick how long it has to hold, and hit the red key.
If the price prints inside your band at the cutoff block, you get paid the multiplier.
The whole round takes three seconds.

Monad settles a block every 300ms. That is the entire reason this works: a three-second
round is a real market with a real cutoff, not a countdown timer waiting on a chain.

```
pnpm install
pnpm dev            # the console, on paper — no wallet, no funding
```

The demo desk needs nothing. It fetches the real current price, replays real
one-second market tape, and prices every band with the same code the contracts use.

---

## What is actually real

| Piece | What it is |
|---|---|
| Prices | Live Binance one-second tape; MON marks against Kuru's on-chain MON-AUSD book |
| Stablecoin | Agora **AUSD** (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`), the real token |
| Distribution | Measured from real tape per round length — not an assumed bell curve |
| Settlement | A public transaction anyone can send once the cutoff block passes |
| Demo desk | Replays real returns; identical pricing kernel to the deployed contract |

There are no mocks in what ships. The one test double (`TestOracle`) lives under
`packages/contracts/test/helpers/` and is unreachable from `src/` or any deploy script.

---

## The interesting part: the price does not move

Over a three-second BTC round, the price often does not move **at all** — the same tick
prints at both ends. A normal distribution puts exactly zero probability on that, so
pricing a tight band off a bell curve hands the player a multiplier the house cannot
cover.

So every round carries a **measured** distribution table, built from real tape, sampled
on a 0.25σ grid and stored on-chain. `Pricing.sol` interpolates it. The TypeScript in
`packages/sdk` mirrors it exactly — 1,728 quotes are diffed between the two on every
test run, and they are identical.

```
pnpm calibrate      # refit from live tape, regenerate both implementations
```

### And the honest part: the spread is wider than the fee

The fee is 4%. The effective edge is not.

Volatility moves faster than any fixed calibration. Fitting on the immediately
preceding window errs in *both* directions — measured on held-out tape, an unshaded fit
ran between +5% and −25% per round depending purely on which way the regime moved. A
market that is profitable or ruinous depending on the weather is not a market.

So the modelled chance is deliberately estimated off the quieter end of what the market
has recently done. That buys a one-sided guarantee — the vault stays solvent when
volatility falls away under it — and it costs a wide spread. The calibration's own
forward validation targets a few percent; measured against a *different* window the
realised edge has run from about 10% on the shortest rounds to over 40% on the longest,
moving with the regime. It is always in the house's favour, which is the point, but it
is not 4% and the app does not claim it is.
`tools/checks/paper-calibration.mjs` measures it against real tape and fails if any
round length turns player-positive.

This is why **no win percentage is printed on the deck**. The model's number is a
pricing input, not a forecast, and showing it as one would be a lie. The keeper narrows
the spread by re-marking volatility on-chain as it moves.

---

## Layout

```
packages/contracts   Solidity — RangeMarket, RoomMarket, XorrVault, oracle adapters
packages/sdk         Pricing kernel, paper engine, calibration, generated ABIs
apps/web             Next.js console (landing, desk, /api/price /api/leaderboard /api/rpc)
tools                Keeper, model generator, calibration and verification checks
```

### Contracts

- **RangeMarket** — quote, fire, stack, settle. `fireBand` takes a band's *shape* and
  centres it on the print at execution, which removes a race that reverts opens on a
  300ms chain.
- **XorrVault** — the bankroll. Reserves the **full payout** on every open ticket, so a
  round where every player wins is still fully covered. Capped at 80% utilisation.
- **RoomMarket** — player-vs-player rooms. The house takes a fee and carries no risk.
- **Oracles** — `KeeperOracle` (a real push feed with a deviation guard),
  `ChainlinkOracle`, `PythOracle`. Nothing named "mock" is deployable.

### Running it live

```
anvil --fork-url https://rpc.monad.xyz --block-time 0.3 --chain-id 143
cd packages/contracts && forge script script/Deploy.s.sol:Deploy --broadcast \
  --rpc-url http://127.0.0.1:8545
tools/setup-local.sh          # funds the vault with real AUSD, starts the keeper
pnpm --filter @xorr/web build && pnpm --filter @xorr/web start
```

The fork gives real Monad state, the real AUSD contract and real signed transactions
at 300ms, without spending anything.

---

## Tests

```
pnpm test           # 71 Solidity tests, 26 TypeScript tests
pnpm parity         # 1,728 quotes diffed between Solidity and TypeScript
```

Beyond unit tests, `tools/checks/` holds the ones that check claims rather than code:

| Check | Question it answers |
|---|---|
| `chain-parity.mjs` | Does the deployed contract quote what the SDK quotes? |
| `paper-calibration.mjs` | Does the demo desk's realised edge favour the vault, on real tape? |
| `edge-by-width.mjs` | Is the edge stable across band widths, or punitive at some? |
| `sigma-percentile.mjs` | How conservative does volatility have to be to stay solvent? |
| `live-win.mjs` | Is a winner paid exactly the payout the ticket promised? |
| `room-round.mjs` | Does a room's pot close out to exactly zero? |

`docs/TEST-PLAN.md` is the full plan every component was verified against.
