# XORR — build plan

**Read this first if you are picking the project up cold.** It defines what winning
means, the phases to get there, every task under each phase with a status tag, and an
honest audit of every gap between what exists and what is claimed.

Status tags: `DONE` · `IN PROGRESS` · `NOT STARTED` · `BLOCKED`

---

## 0. Orientation

XORR is a handheld-console web app for trading **short-dated price ranges** on Monad.
You paint a band around the price, pick a cutoff (3s / 10s / 30s / 100s / 5m / 15m), and
get paid a multiplier if the price prints inside the band at the cutoff **block**.

The submission targets the **Kuru on-chain order book sponsor track**. The central claim
is not "we use a price feed" but **"our price *is* the order book"** — `KuruOracle` reads
`bestBidAsk()` on Kuru's deployed MON-AUSD CLOB on-chain, at the block being settled on,
with no relayer and nothing off-chain in between.

```
packages/contracts   Solidity: RangeMarket, RoomMarket, XorrVault, oracle adapters
packages/sdk         Pricing kernel, paper engine, calibration, console geometry, ABIs
apps/web             Next.js console + /api/kuru /api/price /api/leaderboard /api/rpc
tools                Keeper, model generator, verification checks
docs                 TEST-PLAN.md, HACKATHON.md, DEMO.md, IDEAS.md
```

**Current size:** 21 commits · 2,379 lines Solidity src · 1,819 lines Solidity test ·
2,713 lines SDK · 5,923 lines web · 1,265 lines tools.

**Current verification state:** 104 Solidity tests, 33 TypeScript tests, 1,728
cross-implementation quotes, 7 claim-checking scripts under `tools/checks/`, and a
239-item plan in `docs/TEST-PLAN.md` at 238 PASS / 1 untested.

**Environment.** Everything runs against `anvil` forking Monad mainnet at 300ms with
chain id 143 — real Monad state, the real Agora AUSD token, the real Kuru book, real
signed transactions, no real money. There is **no public deployment**.

---

## 1. Goals — what "done" and "winning" actually mean here

These are this project's goals, not generic ones.

### G1 — The order-book claim is true, and a judge can check it in under a minute
The sentence "the price is the book, read on-chain" must be verifiable without trusting
the interface. That means: the oracle reads the real deployed Kuru market; provenance is
answerable from the chain (`OracleRouter.sourceOf`); the addresses are printed in the UI;
and one command (`pnpm check:kuru`) proves it against the live market.
**Status: substantially met.**

### G2 — An order book fails differently from a feed, and the system knows it
A push feed fails by going silent. A book fails by going **thin** — and a thin book still
returns a number. Refusing to price a one-sided, crossed, too-wide, sub-resolution or
dust-backed book is the part that shows the integration is understood rather than
plumbed. **Status: met.**

### G3 — Nothing on screen is fake
No mocks, no stubs, no fallback prices, no invented leaderboard, no seeded demo data
dressed as real. When an upstream is unreachable the app says so and shows nothing rather
than a plausible number. **Status: met, and continuously re-checked.**

### G4 — The pricing is defensible under questioning
Over a 3s round the price often does not move at all; a normal distribution puts zero
probability on that. Each round carries a **measured** distribution table on-chain, and
the Solidity and TypeScript implementations are diffed on 1,728 quotes every run. The
house edge is stated honestly rather than hidden. **Status: met.**

### G5 — The vault cannot go bust
Full payout reserved at open (not expected profit), 80% utilisation cap, and no round
length that is player-positive against real tape on any window. **Status: met — but this
is the property most likely to regress; see Phase 6.**

### G6 — A judge can actually try it
**Status: met for the console, short of it for the chain.** The desk is live at
**https://xorr-monad.vercel.app** — real Binance tape through the same pricing kernel
the contracts use, and Kuru's real market read on Monad mainnet. Firing a real ticket
still needs the local bring-up, which is now `pnpm demo` rather than six commands. The
public build says which parts are not in its path rather than implying they are.

### G7 — The pitch lands in three minutes
`docs/DEMO.md` is a written script. There is no recording, and several numbers in it are
stale. **Status: partially met.**

### Explicit non-goals
Perps, options surfaces, multi-leg structures, a token or points system, AI trade
suggestions, and a social feed. All ranked and cut deliberately in `docs/IDEAS.md` — they
dilute "one idea, executed properly".

---

## 2. Phases

Ordered by what actually has to happen next, not by a template. **Phases 1–4 are
essentially complete**; the work that remains is concentrated in **Phases 5–8**.

| Phase | Theme | State |
|---|---|---|
| 1 | Core protocol — market, vault, pricing kernel | DONE |
| 2 | Order-book integration (the sponsor track) | DONE |
| 3 | The console — desk, band painter, live mode | DONE |
| 4 | Screens and real data | DONE |
| 5 | **Judgeability — deploy, record, verify** | DONE except the recording (5.5) and a public *chain* deploy (5.3/5.4), both blocked for stated reasons |
| 6 | **Solvency hardening and operations** | DONE |
| 7 | Documentation truth pass | DONE |
| 8 | Depth items — remaining ranked ideas | IN PROGRESS — the order-book items and the unreachable contract are done; the motion/polish tail is not |

---

## Phase 1 — Core protocol

Everything here is deployed on the fork and covered by tests.

| # | Task | Status |
|---|---|---|
| 1.1 | `RangeMarket`: quote / fire / stack / settle against a measured probability table | DONE |
| 1.2 | `fireBand` takes a band's *shape* and centres it at execution, removing the 300ms open race | DONE |
| 1.3 | `XorrVault`: reserve **full payout** per open ticket; 80% utilisation cap; ERC4626-style shares | DONE |
| 1.4 | `Pricing.sol`: interpolate a 17-point 0.25σ table; house edge; probability floor | DONE |
| 1.5 | `bandLimits` solves min/max half-width by **bisection** against the same arithmetic `fire` uses | DONE |
| 1.6 | Band floor sits at the first measured knot (`sigma/4`), so nothing is sold below measurement | DONE |
| 1.7 | `RoomMarket`: player-vs-player pots, house takes a fee and carries no risk | DONE (contract only — see 8.1) |
| 1.8 | `KeeperOracle` with a deviation guard against a compromised keeper | DONE |
| 1.9 | `ChainlinkOracle`, `PythOracle` adapters | DONE |
| 1.10 | Staleness semantics: inside the window settlement reverts; past it the ticket voids and refunds in full | DONE |
| 1.11 | 104 Solidity tests including fuzz invariants (reserved ≤ assets; EV always < 1; pot always closes out) | DONE |

## Phase 2 — Order-book integration (the sponsor track)

| # | Task | Status |
|---|---|---|
| 2.1 | `KuruOracle.latest()` — price a market from the CLOB, on-chain, no relayer | DONE |
| 2.2 | Thin-book guards: one-sided, crossed, spread-over-limit, sub-8-decimal | DONE |
| 2.3 | `depth()` — decode Kuru's L2 ladder on-chain so the client gets typed levels in one call | DONE |
| 2.4 | `marketParams()` — tick size, min/max size, taker fee read from the venue, never hard-coded | DONE |
| 2.5 | Microprice (`Mark.MICRO`) — size-weighted mid, leaning toward the thinner side | DONE |
| 2.6 | Dust guard — a side under `minDepth/20` cannot set the mark; falls back to the midpoint | DONE |
| 2.7 | Depth floor — real size required within a band of the mid before the oracle will quote | DONE |
| 2.8 | `OracleRouter` — per-market dispatch, `sourceOf()` for on-chain provenance | DONE |
| 2.9 | `/api/kuru` — book, depth, marks, params and configured mark, all from contract calls | DONE |
| 2.10 | Order-book panel: ladder with depth bars, mid row, block number, provenance addresses | DONE |
| 2.11 | Book-health verdict (tight / wide / thin / resting / quiet / one-sided / crossed) with the reason | DONE |
| 2.12 | Deck strip showing bid / ask / spread / health without opening the panel | DONE |
| 2.13 | Mark explainer — names the rule in force and says when the dust guard overrode it | DONE |
| 2.14 | Add funds by selling MON into Kuru's book through the Router; quote walks real resting bids | DONE |
| 2.15 | Partial fills refused with a "use N instead" escape hatch | DONE |
| 2.16 | `pnpm check:kuru` — verifies the deployed market end to end, including the dust-guard assertion | DONE |

## Phase 3 — The console

| # | Task | Status |
|---|---|---|
| 3.1 | Paper desk replaying **real** one-second tape through the same pricing kernel as the chain | DONE |
| 3.2 | Band painter with keyboard and drag, clamped to solved limits | DONE |
| 3.3 | Live console on-chain: connect, switch to chain 143, simulate-then-send, check receipt status | DONE |
| 3.4 | Cutoff ring counting **blocks**, red at ≤20% remaining, tracking the ticket that settles soonest | DONE |
| 3.5 | House battery — vault utilisation against the 80% cap | DONE |
| 3.6 | Procedural 3D console built in-process (no CDN GLTF/DRACO fetch), with a WebGL probe and context-loss handler | DONE |
| 3.7 | Synthesised WebAudio engine, no AudioContext before a user gesture | DONE |
| 3.8 | Reduced-motion mode that is genuinely still | DONE |
| 3.9 | Four themes; screen and readout deliberately not themeable | DONE |

## Phase 4 — Screens and real data

| # | Task | Status |
|---|---|---|
| 4.1 | History from real settled tickets | DONE |
| 4.2 | Leaderboard aggregated from real settlement events; empty when nobody has settled | DONE |
| 4.3 | Achievements as predicates over tickets that actually settled | DONE |
| 4.4 | Vault screen — deposit, withdraw, share of bankroll, utilisation | DONE |
| 4.5 | Account screen — real balances, live head block, deployment addresses printed | DONE |
| 4.6 | Settings that persist and change behaviour | DONE |
| 4.7 | How-it-works and About, stating the model and the spread honestly | DONE |
| 4.8 | `/api/rpc` proxy with a method allowlist | DONE |

---

## Phase 5 — Judgeability *(NOT STARTED — highest value remaining)*

**Why this phase matters more than any other remaining work.** Every technical claim is
already true and checked. What is missing is the ability for someone who is not sitting
at this machine to see it. A judge who cannot run the project scores what they can read.

| # | Task | Status |
|---|---|---|
| 5.1 | **Decide the public target.** Options: (a) Monad testnet deploy, (b) a hosted anvil-fork behind a public RPC, (c) paper-desk-only public build with live Kuru reads via `/api/kuru` against public Monad RPC. (c) is cheapest and still demonstrates the order-book integration, because reading the book needs no deployment of ours. Write the decision and its trade-offs into this file before building. | DONE — decided **(c)**, and the reasoning is below the table. (a) is blocked: Monad testnet needs a funded key and `PRIVATE_KEY` is empty, with no scriptable faucet. (b) needs a paid always-on host for anvil, and its forked AUSD holder drains as people use it. |
| 5.2 | Deploy `apps/web` to a public URL (Vercel or Railway). Set `NEXT_PUBLIC_*` for the chosen target. **`XORR_ALLOW_UNLOCKED_ACCOUNTS` must be unset in production** — it enables `eth_sendTransaction` and account-unlock methods through the proxy. | DONE — live at **https://xorr-monad.vercel.app**. Functions run in `fra1`: Binance answers Vercel's US region with HTTP 451, and the desk correctly refused to invent a price rather than showing one. `XORR_ALLOW_UNLOCKED_ACCOUNTS` is absent — the deployment has exactly four variables |
| 5.3 | If 5.1 chooses a chain deploy: run `Deploy.s.sol` against Monad testnet with `KURU_MON_AUSD` set, commit `deployments/<chainid>.json`, fund the vault, run the keeper on a host that stays up. | BLOCKED — needs a funded Monad testnet key. `PRIVATE_KEY` is empty, and the testnet faucet cannot be scripted. Not attempted rather than faked |
| 5.4 | Verify contracts on the target explorer and emit verification metadata in the deploy output (idea #93). | BLOCKED — depends on 5.3; there is no public deployment of the contracts to verify |
| 5.5 | Record a 3-minute demo video following `docs/DEMO.md`, and fix that script's stale numbers first (see 7.2). | BLOCKED — recording a narrated screen capture is not something I can do. Everything it depends on is ready: `docs/DEMO.md` is corrected, its setup is one command, and the console is live at the public URL |
| 5.6 | Write a **judge-facing one-pager** (idea #100): each claim, and the exact command that proves it. `pnpm check:kuru` for the book, `pnpm parity` for the two implementations, `pnpm check:edge` for solvency, `pnpm check:chain` for deployed-vs-SDK agreement. | DONE — `docs/VERIFY.md`, every claim paired with the command that proves it |
| 5.7 | Add `pnpm demo` (idea #92): one script that starts anvil, deploys, funds, starts the keeper and serves the app, with a readiness check on each step. Removes six manual steps from `docs/DEMO.md`. | DONE — verified end to end: fork → deploy → fund → keeper → build → serve, all three health parts green |
| 5.8 | Health endpoint `/api/health` reporting chain reachability, keeper freshness and book status (idea #81) — so "is the demo up?" is one request. | DONE — happy path and the degraded path both exercised: stopping the keeper flipped it to `degraded` with the real print age |
| 5.9 | Favicon, web manifest, and an OG preview image. `layout.tsx` has `openGraph` title/description but **no image and no icons**. | DONE — `icon.svg`, `manifest.webmanifest` and a generated `opengraph-image`; all three serve, the OG render visually checked |
| 5.10 | README diagram of the settlement path: wallet → RangeMarket → OracleRouter → KuruOracle → Kuru book (idea #96). | DONE — mermaid settlement path in the README, with the single off-chain hop marked |

### 5.1 — the public target, decided

**Deploy the console to Vercel's free tier, with the paper desk fully live and Kuru's
book read directly from Monad mainnet. Our own contracts stay on the local fork.**

What a judge gets without installing anything: the real console, opening on a real
Binance price and replaying real one-second tape through the identical pricing kernel
the contracts use, and a live order-book panel reading Kuru's deployed MON-AUSD market
on Monad mainnet at a block they can check.

What they do not get, and why it is said rather than hidden: firing a real ticket. That
needs XORR's own contracts deployed to a public chain, which needs either a funded
Monad testnet key — there is none in the repo, and no faucet that can be scripted — or
a paid always-on host running the mainnet fork. Neither exists here, so the live desk
on the public build points at `pnpm demo`, which brings the whole thing up locally in
one command against real Monad state.

The honest cost of this choice: on the public URL, the sponsor-track claim is
demonstrated one step short of its strongest form. The panel shows Kuru's real book
read on-chain, but read directly rather than through `KuruOracle` — because our oracle
is a deployed contract and there is nothing to deploy it to for free. The guards that
make the integration interesting (thin, crossed, one-sided, dust) live in that contract,
so they are provable in one command locally and only described on the hosted build. The
panel says exactly this rather than implying the oracle is in the path.

## Phase 6 — Solvency hardening and operations *(IN PROGRESS)*

The vault edge is the property most likely to regress silently, and it has regressed
three times already. The structural fix landed (`527611c`); the operational half has not.

| # | Task | Status |
|---|---|---|
| 6.1 | Quote the **envelope** of recent win rates (65th percentile across sliding windows) rather than a point fit — the fix for the recurring player-positive 3s round | DONE |
| 6.2 | `check:edge` sweeps four disjoint tape windows and fails if any round is player-positive on any of them | DONE |
| 6.3 | `check:edge` fails when a round quotes nothing (previously `NaN > 1` was false, so an empty book passed) | DONE |
| 6.4 | **Keeper drives `remark` on a cadence** so sigma tracks the regime instead of hedging against it. `pnpm remark` exists and works; nothing calls it automatically. This is the stated "honest next step" in `docs/HACKATHON.md` and it is not built. | DONE — the keeper refits sigma from 160,000 candles and pushes it via `setRoundConfigs`, off the hot loop so the 1.5s publish never waits on it. Verified on-chain: BTC tier 0 went 3573 → 3800 (+6.4%) in a real signed transaction |
| 6.5 | Structured logging in the keeper (idea #82) — currently plain `console.log`. Needed to tell "the keeper is fine" from "the keeper is wedged" during a demo. | DONE — one JSON object per line; `start`, `published`, `settled`, `remarked`, `rebased`, and the failure events, each with fields rather than a sentence |
| 6.6 | Prove keeper restart-safety with a test rather than a comment (idea #83). It re-bases past the deviation guard after a gap; that path has no test. | DONE — `test_KeeperRecoversFromAGapByRebasing` walks the exact restart sequence: push, gap, guard refuses the batch, the stale print survives untouched, owner re-bases, publishing resumes |
| 6.7 | Transaction queue so two fires cannot collide on a nonce (idea #76). No nonce management exists in `useLiveDesk.ts`. | DONE — a per-session queue on fire and settle. Verified live: two presses in the same tick produced tickets #2 and #3 at consecutive blocks from one account, no collision, balance down exactly two stakes |
| 6.8 | Retry with backoff on RPC failure, surfaced rather than hidden (idea #78). | DONE — backoff on transport failures only; a reverted simulation is an answer and is never retried |
| 6.9 | Rate-limit `/api/price` and briefly cache upstream prices to survive an exchange hiccup (ideas #79, #80). Currently every client request hits Binance with `cache: "no-store"`. | DONE — 1s spot / 15s history cache with in-flight de-duplication, plus a 60-per-10s per-caller limit. Verified: identical price within TTL, and 70 rapid calls gave 58×200 then 12×429 |
| 6.10 | Run `check:edge` in CI on a schedule so a regime change is caught by the repo, not by a judge. Depends on 7.5. | DONE — `.github/workflows/ci.yml` on every push, `edge.yml` every six hours. Both new gates run clean locally |

## Phase 7 — Documentation truth pass *(IN PROGRESS)*

Every number in the docs is a claim. Several are now false. This project's whole posture
is "check what we say", so a stale number costs more here than in an ordinary repo.

| # | Task | Status |
|---|---|---|
| 7.1 | `README.md` says **"90 Solidity tests, 33 TypeScript tests"**. Actual: **104 and 33**. | DONE |
| 7.2 | `docs/HACKATHON.md` closes with **"71 Solidity tests, 26 TypeScript tests"**. Actual: **104 and 33**. | DONE |
| 7.3 | `docs/DEMO.md` says the real spread is **"about 6% on short rounds"**. Actual, post-envelope: **about 3% to 42% across four windows**, driven by regime rather than round length. The same passage is already corrected in the app, README and HACKATHON.md — DEMO.md was missed. | DONE |
| 7.4 | `.env.example` documents `ORACLE_KIND` as **`mock \| chainlink \| pyth`**. `Deploy.s.sol` accepts **`keeper \| chainlink \| pyth`** and has no mock path. The file advertises a mock that cannot be deployed, directly contradicting the "no mocks" claim. | DONE — and the file was worse than stale: it omitted `KURU_MON_AUSD` (the sponsor-track variable) and six others the code reads, while listing three nothing reads. Rewritten against a grep of `process.env.*` and the deploy script's `envOr` calls; the stale `deployments/31337.json` recording `"oracleKind": "mock"` is deleted. |
| 7.5 | `docs/DEMO.md`'s setup block omits `KURU_MON_AUSD=…` before `Deploy.s.sol`. Without it the Kuru oracle is never configured and the MON market — the sponsor-track market — is silently absent. | DONE — the block is now `pnpm demo`, which fails loudly if the Kuru oracle or real AUSD is missing |
| 7.6 | README's check table omits `tools/checks/ui-quote.mjs`, which exists. | DONE |
| 7.7 | Security notes: what is trusted, what is not (idea #98). Guards are documented per-contract; there is no single page a judge can read. | DONE — in `docs/VERIFY.md`: what is trusted, what is not, and the known exposures |
| 7.8 | `docs/TEST-PLAN.md` summary now covers all 18 sections and this run's re-verification | DONE |

## Phase 8 — Depth items from the ranked backlog

`docs/IDEAS.md` ranks 100 ideas; 24 are built. These are the unbuilt ones that still earn
their place, in ranked order. Everything not listed here was cut deliberately — read
"What got cut and why" before adding anything back.

### 8a — Order-book depth (highest remaining value; strengthens the track pitch)

| # | Idea | Task | Status |
|---|---|---|---|
| 8.1 | #11 | Settle-price provenance in the tape: each settled row reads "settled on Kuru mid @ block N" | DONE — each settled row now reads "settled on Kuru's book at …" or "settled on Binance at …". A printed price with no provenance is an assertion; with it, it is a receipt |
| 8.2 | #13 | Show the live basis between Kuru's mid and Binance's mid — makes "our price is the book" concrete by showing where it differs | DONE — MON is not on Binance, but Coinbase quotes MON-USD, so the panel puts the on-chain book beside a centralised one: their spread 6.4 bps against Kuru's 198, a +27 bps basis, 31x wider. Reported, never corrected for |
| 8.3 | #14 | Fall back from Kuru to the keeper feed **explicitly and visibly**, never silently. Today `OracleRouter` has a fallback; the UI does not announce when it is in use. | DONE — the panel reads `OracleRouter.sourceOf` and shows where MON is routed. Verified by actually repointing the route on-chain to the keeper feed: the panel turned red, named the address and label, and the provenance paragraph switched to the past tense rather than continuing to claim the mark comes from the book |
| 8.4 | #15 | Micro-sparkline of the spread over the last N blocks | DONE — twenty samples of the spread on the deck's strip, scaled to their own range so a steady book reads flat rather than as noise around zero. Verified live: "198 to 198 bps" |
| 8.5 | #22 | Encode band edges in tick-size units so they align to the book's grid | DONE — and the right grid is the HALF-tick, not the tick: bid and ask are tick multiples, so their midpoint lands between them. Snapped outward only, never taking away width the player painted. Verified: displayed prices all land on the grid |
| 8.6 | #23 | Store a depth snapshot with each ticket, for auditable settlement | NOT BUILT, BY DESIGN — storing a depth snapshot per ticket duplicates data the chain already has, at real gas, and is *less* trustworthy than reading it back: a stored copy is something we asserted. The ticket already carries its open and settle blocks, and 8.7 reads the ladder at those blocks with the same contract call. That is the auditable version |
| 8.7 | #24 | "Book replay" on a history row: what the ladder looked like at the cutoff | DONE — `/api/kuru?block=N` answers the same contract call with a block tag, and the panel steps back through the chain. Verified: stepping −3k moved the ladder from block 101522428 to 101519428, badged REPLAY, "≈15 min ago" |
| 8.8 | #12 | Colour depth bars by size relative to the book's own median | DONE — bars shade against the book's own median rest rather than its largest, so a level reads as normal-or-not for this book and dust reads as dust |
| 8.9 | #18/#19/#20 | Second Kuru-priced market, a picker reading the Router's deployed markets, and a cross-market stale-book alarm | BLOCKED — needs a second liquid Kuru market to exist |

### 8b — Functional

| # | Idea | Task | Status |
|---|---|---|---|
| 8.10 | #27 | **Rooms UI.** `RoomMarket` is deployed and has 12 passing tests, but `roomMarket` is read in `chain.ts` and used nowhere. An entire working contract is unreachable from the product. | DONE — create, join by code, lobby and settle, all real transactions. Verified live: room `3LE74` opened by one account and joined by another, pot $5 → $10, both bands on screen, and the vault's reserved stayed at 0 throughout |
| 8.11 | #37 | Keyboard shortcuts in live mode. `PlayScreen` binds `keydown`; `LiveConsole` binds none. | DONE — `a`/Enter fires, `[` and `]` walk the band, matching the demo desk. Verified live: 1.59x → 1.39x on widening, → 1.91x on tightening |
| 8.12 | #38 | Touch drag for band edges on mobile | DONE — already correct: pointer events with `touchAction: none`. Verified with a real `pointerType: 'touch'` drag on the band edge, 1.28x → 1.38x |
| 8.13 | #35/#36 | Shareable ticket permalink and a per-ticket OG card | DONE — `/t/<id>` renders a ticket from the market contract, and its card is drawn at request time from the same read. Verified: #39 shows +$0.42, printed 77,792.24; #999 says there is no such ticket. Reachable from the live console's last-transaction line |
| 8.14 | #40/#41 | Settle any due ticket you can see, and batch-settle from the UI via `settleBatch` | DONE — the desk surfaces the market's whole due queue, not just the account's, because settlement is permissionless. `settleBatch` proven on-chain: ids [39,40,41] in one transaction, status 0x1, 165,529 gas, 12 logs. Writing it exposed a render loop — the auto-settle effect depended on an object rebuilt every render, so it enqueued a settle per render; now attempted once per id |
| 8.15 | #39 | One-tap "repeat last band" | DONE — AGAIN restores the last accepted shape, clamped to the limits as they stand now. Verified: 1.66x → widened 1.30x → AGAIN → 1.66x |
| 8.16 | #42/#43 | Per-market session P&L in the header; real consecutive-win streak counter | DONE — session P&L and current streak, derived from settled tickets every render. Verified: three 3s rounds gave `+$1.23  3W` against a balance of $251.23 |
| 8.17 | #49 | Position size presets as a percentage of balance | DONE — and the presets refuse to offer what the market would reject: on a $250 balance every percentage exceeds the $10 cap, so all four are disabled with the bound named, rather than silently clamped |
| 8.18 | #50 | Practice mode that fires automatically, so the loop is visible unattended (pairs well with 5.5) | DONE — attract mode fires real paper tickets through the same engine and pricing a person would, and stops on any pointer or key. It is the product running, not a recording |

### 8c — Motion and production polish

| # | Idea | Task | Status |
|---|---|---|---|
| 8.19 | #52 | Settlement flash expanding from the print point on the chart | DONE — a ring expanding from the print, drawn on the chart where the eye already is rather than as a word in a corner. Verified: ring pixels 269 → 635 through a settlement |
| 8.20 | #58 | Band box burning down toward the cutoff, tied to real block progress | DONE — verified against real block progress: ring 329 → 282 blocks while the fill advanced across the projection |
| 8.21 | #59 | Shake on rejection (band too tight / no funds) | DONE — verified with a real refusal at last: nineteen max-stake fifteen-minute tickets drove the demo vault to 78.8%, the twentieth came back HOUSE FULL, and the screen shook |
| 8.22 | #57 | Odometer roll on the price rather than a jump | DONE — only the digits that changed move, 180ms, shorter than a block so the readout is never still catching up. Verified: exactly one column mid-roll across a price change |
| 8.23 | #64 | Boot-sequence loading state instead of a spinner | DONE — three real steps, then the tape fetch with a cursor. If it stalls, the last line printed is where it stalled, which a spinner cannot say |
| 8.24 | #72 | Real error boundary around **each sheet**. Only `Console3D` has one today. | DONE — one boundary inside `Sheet`, so it covers every screen rather than each call site remembering. Names the screen and the error instead of 'something went wrong' |
| 8.25 | #73 | Offline detection with an honest banner | DONE — one banner on the real offline/online events. Verified: appears on `offline`, clears on `online`. Offline, three individually-correct error messages read as three outages of three systems when the fact is one |
| 8.26 | #85 | Mobile viewport correctness at 375px — verify, do not assume | DONE — verified at 375x812 against the public deployment, not assumed: no horizontal overflow, no element past the viewport, the round selector not clipped |
| 8.27 | #88 | Accessibility pass: focus rings, labels, contrast | DONE — zero unlabelled controls (the stake rail was the one, and now announces its step), `lang` set, and a focus ring that is visible on both the cream shell and the black screen. Verified by tabbing: `:focus-visible` matches and the amber ring computes |
| 8.28 | #94 | Test coverage report | DONE — `pnpm coverage` (needs `--ir-minimum`; coverage disables the optimizer and RangeMarket does not fit without it). Numbers in `docs/VERIFY.md`, including the two adapters at 0% |

---

## 3. Gap audit

Read against the codebase, not the README. Every gap is tied to the task it blocks.

### Found while executing this plan — not in the original audit

Three defects that only surfaced by running the thing rather than reading it. All three
were the same shape: a failure that produced a plausible-looking result instead of an
error.

| Defect | Why it mattered | Status |
|---|---|---|
| **An uncertified round shipped silently.** When the walk-forward gate found no probability floor that kept the vault ahead, `chosen` stayed at its initial `1` — a 100% floor, a 1.0x maximum multiplier and an empty band window. A round nobody can buy, inside a table that otherwise looks fine. It fired on live tape during this run: BTC's 15-minute round emitted `minProb1e6: 1000000`. | The tables are the product. Shipping one with a dead round and no error is the worst available outcome. | FIXED — the gate now throws, naming the round, the floor range it swept and how many folds it had. |
| **The longest round was judged on four folds.** `RECENT` capped the tape at 60,000 seconds while 160,000 were available, and a 15-minute round needs 25,200 seconds per fold — about twenty independent rounds to decide solvency on. That is what made the round above fail to certify. | Absence of evidence was being read as evidence against, and the round was killed for it. | FIXED — folds now run over the whole tape (each still fitting its own sigma and table on its own training slice, so nothing leaks forward). Every round certifies; tier 5's ceiling went back to 7.68x from 1.0x. |
| **A deploy without `AUSD` set silently used the test token.** `tools/demo.sh` passed `KURU_MON_AUSD` but not `AUSD`, so `Deploy.s.sol` fell back to deploying `TestAUSD`, while `setup-local.sh` had the real Agora address hard-coded. The two disagreed and the vault rejected a deposit it had just been approved for, surfacing as a bare `TransferFailed`. | The headline claim is that the stablecoin is real. This path quietly made it not. | FIXED — `demo.sh` passes the real address and aborts if the deployment came back with a different one; `setup-local.sh` now reads the token from the deployment instead of assuming it, and refuses to fund anything that is not real AUSD. |

### Blocking a win

| Gap | Evidence | Blocks |
|---|---|---|
| **No public deployment.** The app exists only on `localhost:3000` against a local anvil fork. `deployments/` holds `143.json` (fork) and `31337.json` (stale). A judge must run six commands to see anything. | `ls packages/contracts/deployments` | 5.1–5.3, G6 |
| **No demo recording.** `docs/DEMO.md` is a script with no artifact. | no video in repo | 5.5, G7 |
| **No judge-facing verification one-pager.** The proof commands exist and are scattered across README sections. | idea #100 unbuilt | 5.6 |
| **`XORR_ALLOW_UNLOCKED_ACCOUNTS` is a production footgun.** Set to `1` in `apps/web/.env.local`; it opens `eth_sendTransaction` and account-unlock methods through `/api/rpc`. Safe against a local anvil, unsafe on a public host. | `apps/web/src/app/api/rpc/route.ts:25` | 5.2 |

### Contradicts a stated claim

| Gap | Evidence | Blocks |
|---|---|---|
| **`.env.example` advertises a `mock` oracle kind.** `Deploy.s.sol` supports `keeper \| chainlink \| pyth` only. The repo's headline claim is "no mocks ship". | `.env.example` vs `Deploy.s.sol:38` | 7.4 |
| **`deployments/31337.json` records `"oracleKind": "mock"`.** A committed artifact from a superseded local deploy, pointing at a mock oracle. | `packages/contracts/deployments/31337.json` | 7.4 |
| **README test counts are wrong** — claims 90 Solidity, actual 104. | `pnpm test:contracts` | 7.1 |
| **HACKATHON.md test counts are wrong** — claims 71 Solidity / 26 TypeScript, actual 104 / 33. | `pnpm test` | 7.2 |
| **DEMO.md quotes a superseded spread** ("about 6% on short rounds"). Corrected everywhere else in the same pass; this file was missed. | `docs/DEMO.md` | 7.3 |
| **DEMO.md setup omits `KURU_MON_AUSD`**, so following it exactly produces a build with no Kuru oracle — the sponsor-track integration silently absent. | `docs/DEMO.md` vs `README.md` | 7.5 |

### Built but unreachable

| Gap | Evidence | Blocks |
|---|---|---|
| **`RoomMarket` has no UI.** Deployed, 12 passing tests, address read into `chain.ts:56` and never used. | `grep -rn "Room" apps/web/src` | 8.10 |
| **`xorr-terminal.glb` is a dead asset.** Shipped in `apps/web/public/`, referenced nowhere. `xorr-console.glb` is also unused at runtime by design (geometry is procedural) but is a documented artifact. | `grep -rn "xorr-terminal"` | housekeeping |
| **`tools/checks/ui-quote.mjs` is undocumented.** Exists, not in the README table. | `ls tools/checks` | 7.6 |

### Missing operational safety

| Gap | Evidence | Blocks |
|---|---|---|
| **Nothing drives `remark` automatically.** The script exists and works; the keeper never calls it. HACKATHON.md names this as the honest next step and it is unbuilt — the spread stays wide because the model hedges instead of tracking. | `tools/keeper.mjs`, `package.json` | 6.4 |
| **No CI.** No `.github/` directory. 104 Solidity + 33 TypeScript tests, 1,728 parity quotes and 7 claim checks all run only when someone remembers. | `ls -a .github` → absent | 6.10, 8.28 |
| **No nonce queue.** Two fires in flight can collide. | `apps/web/src/lib/useLiveDesk.ts` | 6.7 |
| **No rate limit or upstream cache on `/api/price`.** Every client poll hits Binance with `cache: "no-store"`. A public deploy would be rate-limited within minutes. | `apps/web/src/app/api/price/route.ts` | 6.9, and 5.2 depends on it |
| **Error boundary only around the 3D canvas.** A throw inside any sheet takes the page down. | `grep -rn "getDerivedStateFromError"` → 1 hit | 8.24 |
| **Keeper logging is unstructured.** `console.log` only; no way to assert liveness programmatically. | `tools/keeper.mjs` | 6.5, and 5.8 depends on it |

### Known and accepted (do not "fix" without re-deciding)

- **MON is mark-only, not fundable.** The book rests: ~13 trades in 24h, no volume in the last hour. A three-second range on a price that cannot move is a free option on the house. The app says exactly this and refuses to trade it. **This is the sharpest tension in the submission** — the sponsor track's market is the one that cannot be traded — and the defence is that recognising it *is* the integration working. If the book's activity changes, revisit idea #5.
- **P-1, continuous Pyth pull updates, untested.** Hermes returns HTTP 401 without an API key and no key exists in the repo. The Pyth contract is verified live on Monad and `PythOracle` reads it; only the VAA cadence is unverified.
- **No win percentage on the deck.** The model's probability is deliberately optimistic — that bias *is* the edge. Printing it would present a pricing input as a forecast.
- **`TestAUSD.sol` lives in `src/`.** Deployed only when `AUSD` is unset, for a chain with no Agora deployment. Not reachable in any configured deploy.
- **`TestOracle.sol` under `test/helpers/`.** The only test double in the repo, unreachable from `src/` or any deploy script. Verified by scan each run.

---

## 4. Recommended order of execution

If you can only do one thing: **Phase 5**. The technical work is done and checked; it is
currently invisible to anyone not at this keyboard.

1. **5.1 → 5.2 → 5.9** — decide the target, deploy publicly, ship the icons and OG image.
   Do 6.9 (rate limit / cache) *before* 5.2 or the public deploy will be throttled.
2. **7.1 → 7.6** — the truth pass. Cheap, and a stale number is expensive in a project
   whose entire posture is "check what we say".
3. **5.5 → 5.6 → 5.7** — record the demo, write the one-pager, collapse setup to one
   command.
4. **6.4** — the keeper driving `remark`. The one substantive engineering item that
   closes a gap the docs themselves name.
5. **8.10** — Rooms UI, if time allows. It is the largest piece of finished, tested work
   currently unreachable from the product.
6. **8a** — order-book depth items, in ranked order. These strengthen the track pitch
   rather than broadening the product.

## 5. Verification commands

Any agent changing pricing, tables or contracts must re-run all of these:

```bash
pnpm test            # 104 Solidity + 33 TypeScript
pnpm typecheck       # both packages
pnpm parity          # 1,728 quotes, Solidity vs TypeScript
pnpm check:chain     # deployed contract vs SDK, every market x tier
pnpm check:kuru      # oracle vs the live Kuru market, incl. the dust guard
pnpm check:edge      # vault edge across 4 disjoint tape windows
pnpm check:width     # edge stability across band widths
```

Changing the calibration also requires `node --experimental-strip-types
packages/sdk/src/calibrate-all.ts` followed by `PRIVATE_KEY=… pnpm remark`, or
`check:chain` will fail — regenerating the tables does not update the deployed contract.
