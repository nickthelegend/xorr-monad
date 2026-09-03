# Verify every claim

Each row is something XORR says about itself, and the exact command that proves or
disproves it. Nothing here needs an account, a key, or trust in the interface.

The console itself is live at **https://xorr-monad.vercel.app** — real tape, real
pricing, and Kuru's market read on Monad mainnet. It has no chain of its own, so the
contract claims below need the local bring-up:

```
pnpm install
pnpm demo          # fork Monad mainnet, deploy, fund, serve on :3000
```

`pnpm demo` refuses to continue if the deploy came back without a Kuru oracle or holding
anything other than real Agora AUSD, so a run that reaches the end is already evidence
of both.

---

## The order book is the price

| Claim | Command | What you should see |
|---|---|---|
| The MON price is Kuru's book, read on-chain by our own contract | `pnpm check:kuru` | The oracle's bid and ask equal the venue's, read from `bestBidAsk()` at a named block |
| A book too thin to trust returns **no price**, not a plausible one | same command | A guard set below the real spread makes the oracle report nothing, and restoring it brings the price back |
| A dust order cannot set the mark | same command | With one side under the depth floor the mark falls back to the midpoint, and `marks()` agrees with what the market settles on |
| Provenance is answerable from the chain, not from us | `cast call $ORACLE_ROUTER "sourceOf(bytes32)(address,bytes8)" $(cast keccak "MON-USD")` | The KuruOracle address and the label `kuru` |
| The panel's numbers are the contract's | open **Menu → Kuru book** | Tick size, min/max order and taker fee are read through `marketParams()`; the ladder carries the block it was read at |

## The pricing is measured, and both implementations agree

| Claim | Command | What you should see |
|---|---|---|
| Solidity and TypeScript price identically | `pnpm parity` | `1728 quotes identical` |
| The deployed contract quotes what the SDK quotes | `pnpm check:chain` | `MATCH` on every market × tier, on sigma, band limits, multiplier and probability |
| The distribution is measured, not assumed | `pnpm test:contracts` | `test_NormalOverpaysAgainstAMeasuredShortRound` — the same band priced off a normal is negative EV for the vault |
| The number on screen is the number charged | `node tools/checks/ui-quote.mjs BTC 0 <spot> <low> <high>` | Recomputes the console's quote from what was displayed |

## The vault cannot go bust

| Claim | Command | What you should see |
|---|---|---|
| Every round is vault-positive on real tape | `pnpm check:edge` | Four disjoint windows, each round positive on all four, with the thinnest edge named |
| A round that quotes nothing is a failure | same command | `*** QUOTED NOTHING ***` is a hard fail — an empty book is not a safe book |
| The edge is stable across band widths | `pnpm check:width` | No negative cell at any width |
| Full payout is reserved at open | `pnpm test:contracts` | `test_VaultCanAlwaysPayEveryOpenTicketEvenIfAllWin` fires 20, wins 20, pays 20 |
| No legal band is ever positive-EV for the player | same | `testFuzz_ExpectedValueIsAlwaysBelowOne` |
| Utilisation is capped | same | Reserved never exceeds assets, for any input |

## It actually settles

| Claim | Command | What you should see |
|---|---|---|
| A winner is paid exactly what the ticket promised | `pnpm check:win` | Payout equals stake × multiplier, to the unit |
| A room's pot closes out to zero | `pnpm check:room` | House takes its fee, players split the rest, nothing left over |
| The whole stack is up | `curl -s localhost:3000/api/health` | `chain`, `keeper` and `book` reported separately |

## Nothing is mocked

```bash
grep -rniE '\b(mock|stub|fakeData|dummyData)\b' \
  apps/web/src packages/sdk/src packages/contracts/src packages/contracts/script tools
```

One hit, in `packages/contracts/test/Base.t.sol` — a comment on the test-only oracle
double under `test/helpers/`, which is unreachable from `src/` or any deploy script.

There is no fallback price anywhere. When Binance, Kuru or the chain is unreachable the
app reports the failure and shows nothing. A stale-but-real price may be served from a
one-second cache; an invented one never is.

---

# Security notes

## What is trusted

- **The chain.** Settlement is a block number. Nothing off-chain can change it.
- **Kuru's order book**, for the MON mark. It is read directly at the settlement block —
  there is no relayer to compromise. What it *can* do is go thin, which is guarded below.
- **The keeper's key**, for BTC/ETH prints only — and only within the deviation guard.
- **Binance**, as the source of the BTC/ETH tape the tables are measured from and the
  keeper republishes. A push feed is the weakest link here, which is why the MON market
  reads a book instead.
- **The owner key**, for `setRoundConfigs`, `setParams` and `setEnabled`.

## What is not trusted

- **The client.** `fireBand` takes a band's *shape* and centres it on the print at
  execution, so a stale client cannot open a band around a price that has moved.
- **A single order.** A side resting less than a twentieth of the depth floor cannot
  move the mark; it falls back to the midpoint.
- **A tight spread on its own.** Depth within a band of the mid is required before the
  oracle will quote at all.
- **The keeper, unboundedly.** `KeeperOracle` rejects a print outside its deviation
  guard, so a compromised key cannot teleport the price. Recovery is an explicit owner
  re-base, not a widened guard.
- **A live oracle at settlement.** Inside the staleness window a stale print blocks
  settlement rather than settling wrong. Past it the ticket voids and refunds in full.
- **Our own arithmetic.** Every quote is diffed against a second implementation.

## Known exposures

- **The vault is exposed to the market becoming quieter than anything in the sample
  window.** Sigma is fitted at the quiet end and the win-rate table quoted at the high
  end, so the modelled chance sits at or above the real one in most regimes — but not
  provably in all. `pnpm check:edge` is the standing measurement, and re-marking sigma
  on-chain is the operational answer.
- **`XORR_ALLOW_UNLOCKED_ACCOUNTS`** opens `eth_sendTransaction` and account-unlock
  methods through `/api/rpc`. It exists so a local anvil's dev accounts can be driven
  from the browser and **must be unset anywhere reachable from the internet**.
- **The owner key is a single key.** No timelock, no multisig. Appropriate for a
  hackathon deployment on a fork; not for real money.
- **MON is mark-only.** Its book rests — a three-second range on a price that cannot
  move is a free option on the house — so the market is deliberately not fundable and
  the app says why.
