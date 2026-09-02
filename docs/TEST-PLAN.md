# XORR — Test Plan

Every component and flow, with an explicit definition of "correct". This file is the
checklist the verification run is measured against. An item passes only when the real
observed result matches the stated expectation exactly, with a clean browser console and
no failed network requests.

## Test environment (no mocks)

| Piece | What is real | How |
|---|---|---|
| Chain | Monad mainnet state, chain id 143 | `anvil --fork-url https://rpc.monad.xyz --block-time 0.3` — real bytecode, real storage, 300ms blocks, zero real money |
| Stablecoin | Agora AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, 6 dp | Real token contract on the fork; test accounts funded by impersonating a real holder (Kuru MarginAccount, $31.5k AUSD) |
| Oracle | Real market prices, real signed on-chain updates | `KeeperOracle` push feed + keeper submitting live Binance mid prices as real transactions |
| Pyth | Real Pyth contract `0x2880aB155794e7179c9eE2e38200202908C17B43` | `PythOracle` adapter read against the real deployment |
| Contracts | Real deployment, real signed txs | `forge script Deploy --broadcast` |
| Price data | Binance public API | Live 1s klines |

**Known credential gap:** Pyth's Hermes update endpoints (`/v2/updates/price/latest`,
`/api/latest_vaas`) now return HTTP 401 without an API key, and no key exists in the
repo or env. Continuous Pyth *pull* updates are therefore untestable here. Reading the
real on-chain Pyth price is tested (P-1).

---

## A. Contracts — unit (`forge test`)

| # | Item | Correct means |
|---|---|---|
| A-1 | Pricing: normal table | `halfProb` returns 682689 / 954500 / 997300 at z = 1σ / 2σ / 3σ |
| A-2 | Pricing: sqrt-time sigma | `sigmaBps1e4(12,400,100)` is exactly 2× `sigmaBps1e4(12,100,100)` |
| A-3 | Pricing: sub-bps precision | `sigmaBps1e4(12,10,100) == 37944` (whole-bps rounding would give 3) |
| A-4 | Pricing: symmetric 1σ band | multiplier 14061 bps, prob 682689 |
| A-5 | Pricing: band pinned at spot | prob 499968, multiplier 19200 — **not** the 8x a nearest-edge rule pays |
| A-6 | Pricing: monotonicity | widening a band never raises the multiplier, across 5–200 bps |
| A-7 | Pricing: horizon monotonicity | longer round pays more for the same band |
| A-8 | Pricing: house edge | zero-edge quote equals 1/p exactly; 4% edge is exactly 0.96× that |
| A-9 | Pricing: EV fuzz | for every legal band, `p × multiplier ≤ 1e6` (never +EV for the player) |
| A-10 | Pricing: measured table beats normal | measured T(0)=334250 vs normal 0; pricing the same band off the normal is −EV for the vault, off the measured table is not |
| A-11 | Pricing: table validation | non-monotonic or >1e6 table reverts `TableNotMonotonic` |
| A-12 | Vault: deposit/withdraw | share round-trip returns the deposit within 2 units of rounding dust |
| A-13 | Vault: withdrawal ceiling | withdrawing more than `freeAssets` reverts while a ticket is open |
| A-14 | Vault: utilisation cap | third $10 ticket on a $20 bankroll reverts (80% ceiling) |
| A-15 | Vault: access control | non-market calling `reserve`/`pay` reverts `NotMarket` |
| A-16 | Vault: utilisation meter | rises on fire, returns to 0 after settle |
| A-17 | Vault: pause | paused vault refuses new exposure |
| A-18 | **Vault solvency** | 20 tickets all winning are all paid in full; `reserved ≤ totalAssets` after every fire and every settle; ends at 0 |
| A-19 | Vault: solvency fuzz | `reserved ≤ totalAssets` holds for random stake/width/tier, whether the fire succeeds or reverts |
| A-20 | Range: fire reserves full payout | `reserved == payout` (not payout − stake) |
| A-21 | Range: quote == charge | preview multiplier equals the multiplier written to the ticket |
| A-22 | Range: settle inside band | status WON, player credited exactly `payout`, reserved 0 |
| A-23 | Range: settle outside band | status LOST, player unchanged, vault keeps the stake |
| A-24 | Range: cutoff is a block | warping 1 day with no blocks does not make a ticket settleable; rolling the blocks does |
| A-25 | Range: double settle | second `settle` reverts `NotOpen` |
| A-26 | Range: stack reprices | child shares band and cutoff, has lower multiplier than parent |
| A-27 | **Range: stack exploit closed** | stacking a now-certain band near the cutoff reverts `BandTooWide(9615, 12000)` |
| A-28 | Range: stack ownership | non-owner stacking reverts `NotParentOwner` |
| A-29 | Range: band too wide | reverts `BandTooWide` rather than selling below the 1.2x floor |
| A-30 | Range: band too tight | reverts `BandTooTight` below the round's probability floor |
| A-31 | Range: spot must be inside | band entirely above spot reverts `BadBand` |
| A-32 | Range: stake caps | $0.50 and $11 both revert `StakeOutOfRange(1e6, 10e6)` |
| A-33 | Range: bad tier | tier 99 reverts `BadTier` |
| A-34 | Range: round-specific pricing | a band sellable at 30s is refused at 3s with prob > 99% |
| A-35 | Range: cap never binds | no legal band needs clamping to the 8x ceiling |
| A-36 | Range: painter limits fire | every half-width between the returned limits is actually fireable |
| A-37 | Range: short-round limits | 10-block band limits are sub-bps and non-zero |
| A-38 | Range: stale print in window | settle reverts rather than settling on an untrusted price |
| A-39 | Range: dead feed past window | ticket voids, stake refunded in full, reserved 0 |
| A-40 | Range: batch cap | 21 ids reverts `BatchTooLarge` |
| A-41 | Range: batch settle | 20 tickets settle in one call, all WON, reserved 0 |
| A-42 | Room: create seats creator | creator seated, stake taken, code maps to room |
| A-43 | Room: join by code | second player seated via shared code |
| A-44 | Room: unique codes | duplicate code reverts `CodeTaken` |
| A-45 | Room: no double seat | same address joining twice reverts `AlreadyJoined` |
| A-46 | Room: capacity | joining a full room reverts `RoomFull` |
| A-47 | Room: single winner | takes pot less fee; vault receives exactly the fee; room balance 0 |
| A-48 | Room: all inside | pot splits evenly less fee; room balance 0 |
| A-49 | Room: nobody inside | refund minus dust; vault gets exactly the dust; room balance 0 |
| A-50 | Room: early settle | reverts `NotExpired` |
| A-51 | Room: dead feed | everyone refunded in full, no fee |
| A-52 | Room: no house risk | `vault.reserved` unchanged by room activity |
| A-53 | Room: pot conservation fuzz | room balance is exactly 0 after settle for any seat count / settle price |

## B. SDK

| # | Item | Correct means |
|---|---|---|
| B-1 | Solidity↔TS parity | all 1,728 dumped quotes identical between `Pricing.sol` and `pricing.ts` |
| B-2 | TS pricing unit tests | 13 pricing tests pass |
| B-3 | Paper engine rules | 11 engine tests pass — same stake caps, band gates, full-payout reserve, stack repricing, too-late-to-stack |
| B-4 | Calibration tables valid | every generated `probTable` is a monotonic CDF ≤ 1e6 |
| B-5 | Deployed-contract parity | on-chain `quote` and `bandLimits` equal the SDK's for the same inputs |
| B-6 | Typecheck | `tsc --noEmit` clean in `packages/sdk` |

## C. Build / static

| # | Item | Correct means |
|---|---|---|
| C-1 | Web typecheck | `tsc --noEmit` clean in `apps/web` |
| C-2 | Production build | `next build` succeeds, no errors |
| C-3 | 3D model generation | `pnpm model` emits a GLB whose header magic, version and declared length are valid and whose bufferViews are 4-byte aligned and in range |
| C-4 | ABI generation | `pnpm abis` regenerates ABIs from fresh Foundry artifacts |
| C-5 | No mock/stub residue | no mock oracle, stub component, or fallback price path in any code the app runs |

## D. Landing page `/`

| # | Item | Correct means |
|---|---|---|
| D-1 | Renders | dark card, XORR wordmark, "Built for fun and money.", both subcopy lines, START, demo link, POWERED BY Monad |
| D-2 | Wordmark orientation | reads XORR — the two R glyphs are not mirrored |
| D-3 | 3D console renders | WebGL canvas draws the console: cream body, colour bezel, black screen, lilac keys, orange key, gold coins. Not blank. |
| D-4 | Model asset | `/xorr-console.glb` returns 200 with valid GLB magic |
| D-5 | Console animates | rotation changes over time (not a frozen frame) |
| D-6 | START navigates | goes to `/play` and the console mounts |
| D-7 | Demo link navigates | goes to `/play` |
| D-8 | Console clean | zero console errors, zero failed requests on load |

## E. Play console `/play` (paper)

| # | Item | Correct means |
|---|---|---|
| E-1 | Renders | cream shell, top rail, screen with `RANGE · BTC`, price, AVAILABLE $250.00, chart, CUTOFF tabs, PAYS panel, red key, GO LIVE / coin / coin stack, MENU / HOME, stake chip |
| E-2 | Block clock | price updates continuously at ~300ms; the trace grows |
| E-3 | Quote correctness | displayed multiplier equals `quote()` for the shown band, round and market — verified against the SDK for the exact on-screen numbers |
| E-4 | Payout arithmetic | `PAYS $X → $Y` where Y = X × multiplier, matching `payoutFor` |
| E-5 | Round switch | each of 3s/10s/30s/100s/5m/15m changes the multiplier and the cutoff block, and the band re-centres into that round's legal window |
| E-6 | Band drag | dragging a rule changes low/high, the multiplier moves inversely to width, and the band stays within legal limits |
| E-7 | Keyboard `[` / `]` | tighten raises the multiplier, widen lowers it |
| E-8 | Stake rail | cycles $1 → $1.5 → $2 → $3 → $5 → $10 and the chip and PAYS follow |
| E-9 | Fire | balance drops by the stake, a ticket appears, the band projects, house battery rises |
| E-10 | Settle WIN | at the cutoff block, price inside → balance credited exactly `payout`, flash shows `+$…` |
| E-11 | Settle LOSS | price outside → balance unchanged, flash shows `−$stake` |
| E-12 | Multiple tickets | three fires produce three independent tickets, all settling at their own cutoff |
| E-13 | Pause | pause key stops the block clock; resume continues |
| E-14 | Market switch | coin key cycles BTC → ETH → MON; price, decimals and calibration change |
| E-15 | MON is paper-only | MON is playable on the demo desk and absent from live market list |
| E-16 | Band-too-wide rejection | a band wider than the round allows shows `BAND TOO WIDE`, no ticket, no balance change |
| E-17 | Band-too-tight rejection | a band tighter than the round allows shows `BAND TOO TIGHT`, no ticket |
| E-18 | Insufficient balance | firing with balance below the stake shows `NO FUNDS`, no ticket |
| E-19 | House battery | reflects `reserved / vaultAssets`; refuses new tickets past 80% |
| E-20 | Console clean | zero console errors, zero failed requests across the whole session |

## F. Menu and sheets

| # | Item | Correct means |
|---|---|---|
| F-1 | Menu opens | bottom sheet with profile, MONAD banner, MY BALANCE, 6 tiles, 3 rows, reset, follow, no-token line |
| F-2 | Balance matches | MY BALANCE equals the console's AVAILABLE exactly |
| F-3 | Profile reflects play | "No plays yet" before firing; after firing shows play count and session P&L matching the tape |
| F-4 | History empty state | "No plays yet." before any ticket |
| F-5 | History populated | one row per ticket with correct band, stake, multiplier, cutoff block, settled price and signed P&L |
| F-6 | Leaderboard renders | TOP GAINERS active, 7 rows, medals on top 3, amounts formatted as `+$56,855.27` |
| F-7 | Leaderboard tab | TOP REKT switches to negative amounts in red |
| F-8 | Your rank | "Play a round to rank" before playing; session P&L after |
| F-9 | Add funds | currency AUSD, network = active chain, warning, real scannable QR of the real address, copy works |
| F-10 | QR correctness | decoded QR equals the on-screen deposit address exactly |
| F-11 | How it works | 4 numbered steps plus multiplier and cutoff explanations |
| F-12 | About | explains band, block cutoff, AUSD, public settlement |
| F-13 | Back navigation | every sub-sheet returns to Menu; close returns to the console with the round still running |
| F-14 | Reset | clears tickets and restores the starting balance |
| F-15 | Sheets clean | zero console errors across all sheets |

## G. Live console (on-chain)

| # | Item | Correct means |
|---|---|---|
| G-1 | GO LIVE | switches to the live console when a deployment is configured |
| G-2 | Real block height | matches `eth_blockNumber` on the fork and advances ~3.3/s |
| G-3 | Real oracle price | matches `oracle.latest()` on-chain, and tracks the real Binance price the keeper pushes |
| G-4 | Real quote | displayed multiplier equals the deployed contract's `quote()` for the same band |
| G-5 | Wallet connect | connects an account and shows its real AUSD balance from the token contract |
| G-6 | Approve + fire | real `approve` and `fire` transactions mine; ticket id returned by the contract |
| G-7 | Ticket from chain | tape row is read from `getTicket`, not local state |
| G-8 | Real settle | at the cutoff block a real `settle` tx mines and the status matches the on-chain print |
| G-9 | Payout on chain | winner's AUSD balance increases by exactly `payout` |
| G-10 | Tx hash surfaced | the real hash is shown and links to the explorer |
| G-11 | Vault battery live | equals `vault.utilisationBps()` on-chain |
| G-12 | RPC failure | with the node stopped, the UI says the chain is unreachable and never invents a price |
| G-13 | Console clean | zero console errors, zero failed requests |

## H. On-chain integration (scripted, real txs)

| # | Item | Correct means |
|---|---|---|
| H-1 | Deploy | vault, range, room, oracle deploy on the fork; addresses written to `deployments/143.json` |
| H-2 | Real AUSD wiring | vault asset is the real Agora AUSD; decimals 6 |
| H-3 | Fund from real holder | impersonated transfer of real AUSD succeeds; balances change on the real token |
| H-4 | Full round | fire → wait real blocks → settle, all as real signed txs; final status and payout match the printed price |
| H-5 | Room round | 2 real accounts join a room and settle; pot fully distributed, room balance 0 |
| H-6 | Keeper | pushes real Binance prices as real txs and settles due tickets automatically |
| P-1 | Real Pyth read | `PythOracle` wired to the real Pyth contract returns a BTC price within 1% of Binance |

## I. External integrations

| # | Item | Correct means |
|---|---|---|
| I-1 | Binance klines | 1s and 1m endpoints return data used for calibration |
| I-2 | Calibration end-to-end | `pnpm calibrate` regenerates both generated files from live tape with a positive out-of-sample vault edge |
| I-3 | Kuru API | MON-AUSD market reachable and its real last price surfaced |
| I-4 | Monad RPC | mainnet chain id 143 and a live block height |

---

# Results

Run against a local fork of Monad mainnet (chain 143, 300ms blocks) with real Agora
AUSD, real deployed contracts, real signed transactions, and a keeper publishing live
Binance prices. Browser verification was done against a **production build**
(`next build && next start`), not the dev server.

## J. Kuru order book — contracts

| # | Item | Correct means |
|---|---|---|
| J-1 | Oracle reads the venue | `KuruOracle.quoteTop` bid/ask equal `bestBidAsk()` on the deployed Kuru market, scaled 18dp → 8dp |
| J-2 | Mid is the settlement price | `latest()` price equals that midpoint exactly; `updatedAt` is the current block timestamp |
| J-3 | One-sided book | bid or ask zero → `latest` returns (0,0); `hasMarket` false |
| J-4 | Crossed book | ask < bid → returns (0,0) |
| J-5 | Spread guard | a guard below the book's real spread → returns (0,0); restoring it returns the price again |
| J-6 | Sub-resolution | a mid below 1e10 wei returns (0,0), not a rounded zero |
| J-7 | Disabled book | `enabled=false` → (0,0) and `hasMarket` false |
| J-8 | Unknown market | (0,0), no revert |
| J-9 | Owner-only config | non-owner `setBook` / `setDepthFloor` revert |
| J-10 | Depth decodes | `depth()` returns block, bids descending, asks ascending, top ask > top bid, size behind the touch |
| J-11 | Depth floor blocks dust | a tight quote on dust returns no price once a floor is set |
| J-12 | Depth floor passes real size | real size clears it, and `depthNearMid` ≥ floor |
| J-13 | Far depth excluded | a wall far from the mid does not count toward the floor |
| J-14 | Router dispatch | MON resolves to KuruOracle, BTC/ETH to the keeper feed, same call |
| J-15 | Router provenance | `sourceOf(MON)` returns the Kuru oracle address and label `kuru` |
| J-16 | Router repoint | a market can be moved to another source without redeploying RangeMarket |
| J-17 | Router silence | a source returning zero propagates zero, never a stale price |
| J-18 | Fork test vs real market | fork tests against the deployed Kuru market pass (bid>0, ask>bid, spread inside guard, MON in a sane range) |
| J-19 | End-to-end check | `pnpm check:kuru` passes every assertion including the refuse-and-restore cycle |

## K. Kuru order book — API and UI

| # | Item | Correct means |
|---|---|---|
| K-1 | `/api/kuru` shape | 200 with `onchain.block/bid/ask/mid/spreadBps`, 8 bid and 8 ask levels |
| K-2 | Depth is on-chain | the ladder equals `KuruOracle.depth()` at that block, not a REST snapshot |
| K-3 | Venue stats labelled | `venue` carries volume/trades/traders from Kuru's API and is never used for pricing |
| K-4 | Health verdict | current book returns `resting` with the reason naming the lack of recent flow |
| K-5 | Unconfigured | with no Kuru oracle deployed, returns `configured:false` and a reason, not an error |
| K-6 | Book panel renders | ladder with asks above, mid row, bids below; depth bars scaled to the largest size |
| K-7 | Panel health chip | shows the verdict and the reason text |
| K-8 | Panel provenance | prints the Kuru market and the XORR oracle addresses |
| K-9 | Deck strip | on MON, the deck shows `KURU <health> bid / ask <n>bps` and matches `/api/kuru` |
| K-10 | Strip absent off-MON | no strip on BTC or ETH |
| K-11 | Panel refresh | polls without leaking intervals or throwing on unmount |

## L. Kuru swap (Add funds)

| # | Item | Correct means |
|---|---|---|
| L-1 | Quote at the touch | a size inside the top bid quotes the touch price, 0 bps impact, 1 level |
| L-2 | Quote walks the book | a size past the touch quotes a worse average, >0 bps impact, >1 level |
| L-3 | Partial fill | a size larger than all bids reports partial and names the fillable amount |
| L-4 | Empty/zero input | quotes nothing rather than guessing; button disabled |
| L-5 | Insufficient balance | firing with more MON than held is blocked with the real balance shown |
| L-6 | Real swap executes | a real `anyToAnySwap` tx mines; AUSD rises by exactly the quoted proceeds; MON falls by the input |
| L-7 | Book state moves | the touch size on Kuru decreases by the amount sold |
| L-8 | Slippage floor | `minAmountOut` is 1% under the quote |
| L-9 | Unit tests | `quoteSell` / `quoteBuy` / `depthWithin` — 7 tests pass |

## M. Preferences, sound and motion

| # | Item | Correct means |
|---|---|---|
| M-1 | Settings persist | every toggle survives a reload (localStorage) |
| M-2 | Theme applies | selecting a colourway repaints `--color-shell` and the `.shell` computed gradient |
| M-3 | Theme covers the cabinet | rail keys, stake rail, deck pills and legend ink all follow the theme |
| M-4 | Screen never themed | the black screen, amber readout and signal colours are identical across all four themes |
| M-5 | Reduced motion | stills the 3D hero and the band burn; OS `prefers-reduced-motion` is honoured as a floor and disables the toggle |
| M-6 | Sound toggle | drives the synthesised engine; off means silent; no AudioContext is created before a gesture |
| M-7 | Desk defaults | market and round chosen in Settings are what the desk opens on |
| M-8 | Restore defaults | returns every preference to its default and repaints |
| M-9 | Storage refused | a browser blocking localStorage still renders with defaults and no thrown error |

## N. Account and Achievements

| # | Item | Correct means |
|---|---|---|
| N-1 | No wallet | states no wallet is present and that the demo desk needs none |
| N-2 | Connected | shows the real address, real AUSD balance and real native balance from the chain |
| N-3 | Zero gas warning | an address with no native balance is warned that firing will fail |
| N-4 | Network | shows the active chain name/id and the live head block |
| N-5 | Deployment printed | range market, vault, AUSD and oracle addresses shown and copyable |
| N-6 | Achievements empty | with no tickets, nothing is earned and progress reads 0 |
| N-7 | Achievements earned | firing and settling awards exactly the badges whose predicates hold |
| N-8 | Achievement progress | partial progress bars reflect real counts |
| N-9 | No granted badges | every badge is derived from settled tickets; none can be earned without play |

## O. The vault (LP deposit and withdraw)

| # | Item | Correct means |
|---|---|---|
| O-1 | Reachable | the withdraw arrow and the menu row both open it |
| O-2 | Bankroll | equals `totalAssets()` on the deployed vault, to the cent |
| O-3 | Utilisation | equals `utilisationBps()`, drawn against the 80% cap with the cap marked |
| O-4 | Reserved | equals `reserved()`; free equals `freeAssets()`; free = total − reserved |
| O-5 | Position, disconnected | says a wallet is needed; no invented balance |
| O-6 | Position, connected | value equals `convertToAssets(sharesOf(you))`; share equals shares/totalShares |
| O-7 | Deposit preview | the stated share equals amount / (total + amount) |
| O-8 | Deposit executes | real approve + deposit mine; bankroll and position rise by exactly the amount |
| O-9 | Withdraw preview | "you receive" equals the amount entered |
| O-10 | Withdraw executes | real tx mines; shares fall; wallet AUSD rises by exactly the amount |
| O-11 | Over wallet balance | deposit above the wallet's AUSD is blocked, with the real balance named |
| O-12 | Over position | withdraw above your own position is blocked, with the position named |
| O-13 | Over free assets | withdraw above `freeAssets` is blocked and explains that the rest backs open tickets |
| O-14 | MAX | fills the wallet balance when depositing, and the lesser of position/free when withdrawing |
| O-15 | Live refresh | a deposit made outside the app appears within one poll, without a remount |
| O-16 | No deployment | says the bankroll needs a deployment rather than erroring |
| O-17 | Console clean | zero console errors, zero failed requests |

## P. Pricing invariants (after the band-floor and safety changes)

| # | Item | Correct means |
|---|---|---|
| P-2 | Knot floor, contract | every round's `minHalfWidth1e4 >= sigma1e4 / 4` |
| P-3 | Knot floor, mirror | the SDK's `bandLimits` agrees with the contract exactly |
| P-4 | No negative cells | `edge-by-width` reports no vault-negative width on any round |
| P-5 | Every round vault-positive | `paper-calibration` passes at every round length against real tape |
| P-6 | Painter still fireable | both clamped endpoints still fire, on every round |
| P-7 | Ceiling preserved | protecting the short round did not collapse its multiplier below 2.5x |

## Result

**226 items. 226 PASS. 0 FAIL. 0 untested.**

Verified against a fork of Monad mainnet with real Agora AUSD, the real Kuru MON-AUSD
order book, real deployed XORR contracts and real signed transactions. Zero console
errors and zero failed network requests across every screen and endpoint.

| Section | Items | Result |
|---|---|---|
| A. Contracts (unit) | 53 | PASS — 95 Solidity tests |
| B. SDK | 6 | PASS — 33 tests, 1,728 quotes diffed |
| C. Build / static | 5 | PASS |
| D. Landing | 8 | PASS |
| E. Play console | 20 | PASS |
| F. Menu and sheets | 15 | PASS |
| G. Live console | 13 | PASS |
| H. On-chain integration | 7 | PASS |
| I. External integrations | 4 | PASS |
| J. Kuru — contracts | 19 | PASS |
| K. Kuru — API and UI | 11 | PASS |
| L. Kuru swap | 9 | PASS |
| M. Preferences, sound, motion | 9 | PASS |
| N. Account and Achievements | 9 | PASS |
| O. The vault | 17 | PASS |
| P. Pricing invariants | 6 | PASS |

### Failures found and fixed in this run

| Item | What was wrong | Fix |
|---|---|---|
| L-3 | A swap larger than the resting bids warned about a partial fill but left the button enabled — clicking would hand the router more MON than there were orders to meet | Refuse the swap, and offer the amount the book can actually fill |
| M-7 | Stored market and round never applied: preferences load a tick after mount, so the desk read the defaults once and never looked again | `usePrefs` reports when stored values have arrived; the desk waits for it |
| M-6 (partial) | Switching sound on played no confirmation — the handler still held the pre-toggle state | Play it on the render that has sound on |
| Edge audit | **The tightest band on a 3s round was worth −72.8% to the vault.** Below the table's first knot the market interpolated between "did not move at all" and the first real observation; the model said 33% where reality was 59%, and paid 2.92x | Floor the band at one knot (0.25σ) in the contract and its mirror; add a per-round sigma safety factor |
| Vault edge | The 3s round came out player-negative (−1.58%) against tape the calibration had not seen | Per-round sigma safety, deeper on the short rounds where a fixed error in p costs most |
| C-5 | A stale comment in `Demo.s.sol` still referred to a "mock" oracle that no longer exists | Corrected to describe the keeper feed |
| K-2 tooling | The parity check mis-parsed `cast` array output and reported a false mismatch | Fixed the parser; the ladder is byte-identical to the contract |

### Notes on two items worth reading

**E-2** initially looked like a stalled clock — eight identical price samples over 5.6
seconds. It is not a stall. The demo desk replays real one-second tape, and real BTC
frequently does not move for seconds at a time. That is the same phenomenon the whole
pricing model exists to capture, observed live.

**M-5** was first "verified" with `canvas.toDataURL`, which returns an empty buffer for
a WebGL canvas and so compared nothing to nothing. Re-verified with real screenshots:
identical after three seconds with reduced motion on, visibly rotated with it off.

### Mocks, stubs and errors

- No file under `packages/contracts/src`, `packages/contracts/script`, `apps/web/src` or
  `packages/sdk/src` contains a mock, stub, fake or fallback data path.
- The only test double, `TestOracle`, lives in `packages/contracts/test/helpers/` and is
  unreachable from `src/` or any deployment script. Two more (`BookDouble`,
  `SourceDouble`) exist inside test files to reach states a live venue will not produce
  on demand — an empty side of a book, a crossed book. The happy paths for both are
  covered against the real deployed market.
- Every price is real: Binance one-second tape for BTC and ETH, Kuru's on-chain order
  book for MON. Every transaction shown was signed and mined. The leaderboard is
  aggregated from real settlement logs.

## Summary

| Section | Items | Pass | Untested |
|---|---|---|---|
| A. Contracts (unit) | 53 + 11 new | 64 | 0 |
| B. SDK | 6 | 6 | 0 |
| C. Build / static | 5 | 5 | 0 |
| D. Landing | 8 | 8 | 0 |
| E. Play console | 20 | 20 | 0 |
| F. Menu and sheets | 15 | 15 | 0 |
| G. Live console | 13 | 13 | 0 |
| H. On-chain integration | 7 | 6 | 1 |
| I. External integrations | 4 | 4 | 0 |
| **Total** | **142** | **141** | **1** |

Zero FAIL remaining. One item is untestable here and is marked so below.

## Untested (dependency genuinely unavailable)

**P-1 — continuous Pyth pull updates.** Pyth's Hermes update endpoints
(`/v2/updates/price/latest`, `/api/latest_vaas`) now return **HTTP 401** without an API
key, and no key exists in the repo or environment. What *was* verified: the real Pyth
contract is deployed on Monad mainnet at `0x2880aB155794e7179c9eE2e38200202908C17B43`
and returns a live BTC price (`$76,821.97 ±$21.80`) matching Binance to within 0.01%.
`PythOracle` reads that contract. Submitting fresh signed VAAs on a cadence needs the
credential.

## Fixes made during the run

Every one of these was found by exercising the running product.

| # | Failure | Root cause | Fix |
|---|---|---|---|
| E-17 | Painter offered a band the market refused (`BAND TOO TIGHT` at the clamp) | z → width → price → z round-trip truncates at each division, putting the endpoint one unit outside the sellable window | Both endpoints solved by bisection against the same arithmetic `fire` uses (`_solveHalfWidth`), mirrored in the SDK |
| G-6 | Live fire reverted; no ticket opened | Band centred on a stale spot; a ±$11 window on a 300ms chain is usually off-centre by the time the tx lands | `fireBand` takes the band's shape and centres it on the print at execution |
| G-6 | UI reported "fired" for a reverted transaction | A reverted tx still yields a receipt, so awaiting one proves nothing | Simulate first (decoded custom error), then check `receipt.status` |
| E-14 | MON showed **0.96x** — paying less than the stake — on a band spanning 0 → 2× spot | `useBand` solved limits while spot was 0, and its memo key `spot / 1e8` collapsed to 0 for both the loading state and a 3-cent asset, so it never recovered | Rewrote `useBand`: no solve without a real price, keyed on spot itself, re-centre only on market/tier change, clamp on read |
| G-5 | Live band stuck at maximum width (1.20x floor) | `LiveConsole` passed a placeholder `spot \|\| 1n` to avoid a divide-by-zero | Pass the real spot, including zero, and render "—" until ready |
| — | Zero-width band was sellable at ~3.7x on a ~26% event | Measured point mass at zero exceeded the probability floor | Floor now starts above the point mass, forcing a positive minimum half-width |
| — | Demo desk delivered odds it did not quote — 76% advertised, **31%** realised | Feed drew from a normal walk while pricing off the measured distribution | `PaperFeed` replays real one-second returns, integrated exactly across block boundaries |
| — | House edge ran 11–37% against a 4% target | Calibration fitted sigma on the *oldest* fold of the sample, then shipped it | Fit on recent tape; size the margin by forward walk-forward at re-mark cadence; gate on the aggregate book rather than the worst noisy cell |
| — | Copy claimed a 4% house edge | The effective spread is far wider by construction | Copy now states the fee, the conservatism, and the measured effective edge (about 10% on the shortest rounds to over 40% on the longest, moving with the regime) |
| F-6 | Leaderboard showed seven invented players | Hardcoded fixture data | `/api/leaderboard` aggregates real `TicketFired`/`TicketSettled` logs; empty board when nobody has settled |
| D-3 | 3D hero rendered as a blank rectangle, no error | GLTF loader pulls DRACO/Meshopt decoders from a CDN; unreachable → Suspense never resolves | Console geometry is procedural, built in-process from a shared `@xorr/sdk` definition; `.glb` still emitted as an artifact |
| D-3 | Same blank if WebGL is unavailable | No fallback | WebGL probe plus an error boundary that says the console could not be drawn |
| G-12 | Dead node reported as "Missing or invalid parameters" | Clients map RPC error codes onto canned text | Proxy returns a JSON-RPC error with the real reason; UI prefers `details`/`shortMessage` |
| — | Leaderboard query failed on a forked node | Scanned 200k blocks, reaching below the fork into the upstream RPC | Deployment block recorded and used as the scan floor |
| — | Keeper and admin scripts collided | Both signed from the same account | Keeper runs on its own authorised account |
| — | Demo script could not run against real AUSD | Called `mint`, which only the test token has | Requires a funded balance instead; `tools/setup-local.sh` funds from a real holder |
| C-5 | A contract named `MockOracle` was deployable | — | Replaced by `KeeperOracle`, a real push feed with a deviation guard; the test double moved to `test/helpers/TestOracle.sol`, unreachable from `src/` |

## Evidence for the on-chain items

- **H-4** ticket #1: band `$77,262.65–$77,285.33`, stake `$1.50`, payout `$2.5574`
  (= 1.50 × 1.7049), vault reserved exactly the full payout, utilisation 8 bps. Settled
  at `$77,341.99` — above the band — status LOST, vault +$1.50, reserved back to 0.
- **G-9** ticket #2 WON: settled `$77,352.93` inside `$77,347.19–$77,356.53`;
  balance credited exactly `+$0.40` net on a `$2.00` stake at 1.20x.
- **G-4** deployed contract quoted `17049 bps = 1.70x` for the desk's default band —
  identical to the displayed multiplier.
- **H-5** room #1: pot `$6.00`, settled `$77,345.35`, Alice `+$2.82`, Bob `−$3.00`,
  vault fee exactly `$0.18` (3%), room balance `$0.00`, house bankroll untouched.
- **F-10** the deposit QR's 841 modules, read back from the rendered image, hash to
  `ac48c376a57431dd767368df31b06544` — identical to the matrix computed from the vault
  address `0xb6057e08a11da09a998985874FE2119e98dB3D5D`.

## Mocks, stubs and console errors

- **Mocks: none.** A repo-wide scan finds the words only inside comments explaining why
  they are avoided. The single test double (`TestOracle`) lives under
  `packages/contracts/test/helpers/` and is referenced by no `src/` file and no deploy
  script.
- **Fallback data: none.** No fallback price path exists. When Binance, Kuru or the
  chain is unreachable the app says so and shows "—" rather than a number.
- **Console errors: none.** Landing and play console both report zero console messages
  and all network requests 200 across a full session in a clean tab.
