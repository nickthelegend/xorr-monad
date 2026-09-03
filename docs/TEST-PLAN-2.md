# XORR — verification plan (second pass)

Written against the surface as it stands now, which is substantially larger than the
first plan covered: the averaged mark, the manipulation-cost read, rooms, permalinks,
book replay, attract mode and the rest all landed after `docs/TEST-PLAN.md` was written.

**"Correct" is stated per item as a specific expected result.** "The button did
something" is not a pass. Every item is checked in a real browser against the running
app, and the console and network are read on every item — a visible error anywhere
fails the item regardless of how the UI looks.

Environment: anvil forking Monad mainnet at 300ms, chain id 143, real Agora AUSD, the
real Kuru MON-AUSD book, real deployed XORR contracts, real signed transactions, the
keeper publishing and poking. Nothing is mocked.

---

## A. Landing page `/`

| # | Item | Correct means |
|---|---|---|
| A-1 | Page loads | HTTP 200, hero renders, no console message of any kind |
| A-2 | 3D console renders | A WebGL canvas with non-uniform pixels — not a blank rectangle |
| A-3 | START navigates | Goes to `/play` and the desk mounts |
| A-4 | Demo-mode link | Reaches the same desk |
| A-5 | Metadata | `<title>`, description, OG image 200 with `image/png`, icon 200, manifest 200 |

## B. Play console `/play` — paper desk

| # | Item | Correct means |
|---|---|---|
| B-1 | Boot sequence | While loading, three real steps then "fetching real … tape" with a cursor — not a spinner |
| B-2 | Real price arrives | Price readout is a real number matching `/api/price` within one tick |
| B-3 | Chart draws | Canvas has a price line and a band box; not empty |
| B-4 | Odometer | Only changed digit columns carry `.roll`; the whole number does not re-animate |
| B-5 | Band `[` widens | Multiplier strictly decreases |
| B-6 | Band `]` tightens | Multiplier strictly increases |
| B-7 | Band clamps | At the stop, the multiplier stops changing and no error appears |
| B-8 | Touch drag on the band | A `pointerType:"touch"` drag changes the multiplier |
| B-9 | Round selector | Each of 3s/10s/30s/100s/5m/15m re-quotes; no "BAND TOO TIGHT" on any |
| B-10 | Fire with `a` | Balance falls by exactly the stake; a cutoff ring appears |
| B-11 | Cutoff ring counts blocks | Counts down, red at ≤20% remaining, disappears at settlement |
| B-12 | Burn overlay advances | The projected band's fill grows as blocks pass |
| B-13 | Settlement flash | A ring expands from the print point on the chart |
| B-14 | Settlement resolves | History gains a row; balance moves by the right amount |
| B-15 | Session P&L | Appears after the first settlement and equals the sum of settled outcomes |
| B-16 | Streak | Shows `nW`/`nL` only when the current run is ≥2 |
| B-17 | Size presets | A preset outside the market's $1–$10 bounds is disabled, not clamped |
| B-18 | AGAIN | Restores the last accepted band's multiplier exactly |
| B-19 | Stake rail | Cycles 1..6 and announces its step to a screen reader |
| B-20 | Market switch | BTC → ETH → MON each load a real price for that market |
| B-21 | Refusal | A refused fire shakes the screen and names the reason |
| B-22 | House battery | Reads the real vault utilisation |
| B-23 | Shared band via URL | `?lowBps&highBps&market` loads that market and that band shape |
| B-24 | Attract mode | Fires unattended on a cadence and stops on any input |

## C. Kuru order book panel — the sponsor track

| # | Item | Correct means |
|---|---|---|
| C-1 | Panel opens | Ladder, mid row, block number all render |
| C-2 | Ladder is the chain's | Prices/sizes equal `/api/kuru`'s, which came from a contract call |
| C-3 | Depth heat | Bars shade against the book's own median, not its max |
| C-4 | Health verdict | Matches the API's `health`, with its reason |
| C-5 | Market rules | Tick, taker fee, min/max order equal `marketParams()` |
| C-6 | Mark explainer | Names the configured mark and says when the dust guard overrode it, naming the side actually under the floor |
| C-7 | Settlement window | States the averaged mark and its block count |
| C-8 | Window move | Shows the touch at the window's opening block and the bps moved |
| C-9 | Manipulation cost | Real notional and level counts, both directions, walked from the ladder |
| C-10 | Book pressure | Bid/ask split matching the ladder's totals |
| C-11 | Why this price | Each guard in the contract's order with this block's numbers |
| C-12 | Basis | Coinbase mid, spread and the basis in bps |
| C-13 | Provenance | Kuru market + XORR oracle addresses, and the router's actual route |
| C-14 | Book replay | Stepping back changes the block, badges REPLAY, and reads a real ladder |
| C-15 | In-band depth on the deck | Says "inside the spread" when the band is narrower than the spread |
| C-16 | Spread sparkline | Renders once ≥3 samples exist, scaled to its own range |

## D. Menu screens

| # | Item | Correct means |
|---|---|---|
| D-1 | History empty | "No plays yet", not a blank list |
| D-2 | History rows | Band, stake, multiplier, cutoff block, and the venue it settled on |
| D-3 | Leaderboard | Real settlement events, or an explicit empty board |
| D-4 | Achievements | Earned flags derived from settled tickets |
| D-5 | Vault | Real totals, utilisation and share; connect prompt when no wallet |
| D-6 | Rooms | Lobby of real rooms with pots, seats and each player's band |
| D-7 | Account | Real balances, live head block, real deployment addresses |
| D-8 | Settings | Every control persists across reload |
| D-9 | Customize | Each theme repaints the shell, never the screen |
| D-10 | How it works | States the fee, the conservatism and the measured edge range |
| D-11 | About | Renders |
| D-12 | Sheet error boundary | A throwing sheet shows its name and the error, desk unaffected |

## E. Live console — on-chain

| # | Item | Correct means |
|---|---|---|
| E-1 | GO LIVE | Switches to live, shows the real head block and a real price |
| E-2 | Connect | Reads the real AUSD balance for the account |
| E-3 | Quote on chain | The displayed multiplier equals the contract's `quote` |
| E-4 | Fire | A real signed tx; stake leaves the wallet; ticket appears on chain |
| E-5 | Two fires in one tick | Both land as separate tickets, no nonce collision |
| E-6 | Keyboard | `a`/`[`/`]` behave as on the paper desk |
| E-7 | Settle | A due ticket settles and pays exactly the promised payout |
| E-8 | Batch settle | The due queue button sends `settleBatch` |
| E-9 | Ticket permalink link | Links to `/t/<id>` for the newest ticket |
| E-10 | Wrong market | MON is refused with `MarketDisabled` — it is deliberately not tradeable |

## F. API endpoints

| # | Item | Correct means |
|---|---|---|
| F-1 | `/api/health` | 200 with chain/keeper/book each reported separately |
| F-2 | `/api/health` degraded | Keeper stopped → `degraded` with the real print age |
| F-3 | `/api/kuru` | Real ladder, marks, params, routed source, basis, manipulation, windowMove |
| F-4 | `/api/kuru?block=N` | Reads that block, sets `replayOf` |
| F-5 | `/api/kuru` bad block | A non-numeric block is ignored, not crashed on |
| F-6 | `/api/price?market=BTC` | Real Binance price at 8dp |
| F-7 | `/api/price&history=1` | ≥900 real 1s returns |
| F-8 | `/api/price` unknown market | Falls back to BTC rather than erroring |
| F-9 | `/api/price` rate limit | >60 in 10s → 429 with `retry-after` |
| F-10 | `/api/price` cache | Two calls inside the TTL return the identical price |
| F-11 | `/api/leaderboard` | Real settlement events |
| F-12 | `/api/rpc` allowlist | A method outside the allowlist is refused |
| F-13 | `/api/rpc` proxy | An allowed read returns the same as the node |
| F-14 | `/t/<id>` | Renders a real ticket at the market's own precision, band edges distinguishable |
| F-15 | `/t/<bad>` | "No ticket", not a crash |
| F-16 | `/t/<id>/opengraph-image` | 200 `image/png` drawn from the chain |

## G. Contracts and on-chain reads

| # | Item | Correct means |
|---|---|---|
| G-1 | `forge test` | All pass |
| G-2 | Solidity ↔ TypeScript parity | 1,728 quotes identical |
| G-3 | Chain parity | Deployed contract and SDK price identically |
| G-4 | Kuru check | Book read on-chain; a thin book returns nothing; averaged mark asserted |
| G-5 | Vault edge | Every round vault-positive on four tape windows |
| G-6 | Width sweep | No negative-edge cell |
| G-7 | Live win | Winner paid exactly the promised payout |
| G-8 | Room round | Pot closes out; house bankroll untouched |
| G-9 | TWAP resists one block | A one-block push moves spot ~20% and the average <1% |
| G-10 | Keeper re-mark | Sigma pushed on-chain via `setRoundConfigs` |
| G-11 | Keeper poke | Observations accumulate; `latest` equals `twap` |

## H. Cross-cutting

| # | Item | Correct means |
|---|---|---|
| H-1 | No mocks in shipped code | Scan of app/sdk/contracts-src/script/tools finds zero |
| H-2 | Console clean | A full session on a fresh tab produces no console message |
| H-3 | Network clean | Every request 200/304; no 4xx/5xx except ones deliberately provoked |
| H-4 | Mobile 375px | No horizontal overflow, no element past the viewport |
| H-5 | Focus ring | Tabbing shows a visible ring on both the shell and the screen |
| H-6 | Labels | Zero unlabelled controls |
| H-7 | Reduced motion | Hero still; odometer does not roll |
| H-8 | Offline banner | Appears on `offline`, clears on `online` |
| H-9 | Foreign service worker | Evicted on boot |
| H-10 | Public deployment | The hosted build serves and reports `via: book` honestly |

**Total: 104 items.**

---

# Results

Run in Google Chrome via the Claude in Chrome extension, against the app running on the
anvil fork of Monad mainnet with the keeper live. Console and network read on every
browser item.

## Failures found, and what was fixed

| Item | What was wrong | Fix |
|---|---|---|
| A-2 | **The hero was blank in any tab that loaded in the background.** react-three-fiber sizes its canvas from a ResizeObserver, and Chrome delivers none to a hidden tab — nor the missed one on becoming visible, because by then the size has not *changed*. Measured: canvas stuck at its 300×150 default against a 372×330 container, and clicking the page did not recover it. Only resizing the window did. | Compare the canvas to the box it should fill after mount and on `visibilitychange`, and dispatch a resize if they disagree. react-use-measure re-measures; the library still owns the sizing |
| H-2 | `THREE.WebGLRenderer: Context Lost` logged on **every** navigation away from the landing page — tearing down a canvas fires the event and Three's own listener logs it | Listen in the capture phase and stop teardown events before Three sees them. A genuine loss still reaches the reader as a message on the page |
| B-2 | **The desk opened ~15 bps from the market while claiming to open where it is.** The chart's backlog was built by walking the feed forward 160 replayed seconds, so the opening price was 160 seconds away from the fetched one. Measured: fetched 77,754, opened at 77,870 | Seed the backlog *backwards* — the same real returns in reverse from the fetched price, so the trace leads up to it. Re-measured: 0.7 bps, which is the market moving between two fetches |
| F-4 | **A replay the node cannot serve took the whole book panel down.** anvil's fork does not keep the venue's bytecode at every historical block; that rejection propagated out of the handler, so asking to look backwards lost the ladder, the mark, the guards and the basis, and rendered a raw client error | Try the requested block, fall back to the present, and say the replay was unavailable |
| C-8 | The touch-at-window-start line was **silently omitted** when unreadable, making an unanswerable question look like a still book | Say it is unavailable and why |
| G-4 | **The averaged mark stopped settling for six seconds.** Caught by the re-run: the check passed, failed, then passed. Across 260 on-chain observations there was exactly one gap over the oracle's five-second tolerance — the keeper awaited each poke's *receipt* before scheduling the next, so confirmation latency became the cadence | Send and schedule on the clock, keeping single-flight only so two sends cannot race for a nonce. Re-measured: 60 observations in 60 seconds, largest gap 1s, none over the limit; check run 5× consecutively, 5 passes |

## Untestable in this environment

Chrome throttles a backgrounded tab's timers to one wake per second, and to one per
minute after five minutes hidden. The Chrome window could not be brought to the
foreground (browser grants are read-only, by design). Sub-second animation therefore
cannot be judged here. These were each verified live earlier in this session on the
same build, and that is stated rather than counted as a fresh pass:

| Item | Earlier evidence |
|---|---|
| B-1 boot sequence | "XORR CONSOLE / pricing tables … measured / band solver … ready / fetching real MON tape" |
| B-4 odometer | exactly one digit column mid-roll across a price change |
| B-12 burn overlay | ring 329 → 282 blocks while the projected fill advanced |
| B-13 settlement flash | ring pixels 269 → 635 through a settlement |
| B-21 refusal shake | 19 max-stake tickets drove the vault to 78.8%, the 20th returned HOUSE FULL and the screen shook |
| B-24 attract mode | fires unattended and stops on input |
| E-6 live keyboard | 1.59x → 1.39x widening, → 1.91x tightening |
| E-8 batch settle | `settleBatch([39,40,41])` in one transaction, status 0x1, 165,529 gas |

**D-12 (sheet error boundary) is untested.** Triggering it needs a fault injected into
shipped code, and adding a test hook for it would violate the no-mocks rule this run is
being measured against. The boundary is present and typed; its fallback path has not
been exercised in a browser.

## Everything else

All remaining items PASS. Zero mocks in shipped code, zero console messages across a
full landing → desk → menu → book session, and every network request 200.
