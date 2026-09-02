# 100 ideas, ranked

Scored on **impact** (would a judge notice) × **feasibility** (buildable for real) ×
**fit** (strengthens the orderbook-track pitch, or clutters it).

The track is **Kuru / on-chain order book**. That reframes the whole ranking: the
strongest thing XORR can say is not "we use a price feed" but **"our price *is* the
order book"** — a derivative settled from the midpoint of real resting orders on Monad's
native CLOB, with no oracle, no relayer, and nothing off-chain between the venue and the
settlement. Everything that sharpens that sentence ranks above everything that does not.

Ideas already built before this pass are excluded.

---

## Tier 1 — the pitch itself (build first)

| # | Idea | Why it wins |
|---|---|---|
| 1 | **KuruOracle: price a market from the CLOB midpoint on-chain** | The whole pitch in one contract. No relayer, no API. |
| 2 | **Thin-book guard** — refuse to price a one-sided, crossed, or too-wide book | Shows you understand an order book can fail in ways a push feed cannot |
| 3 | **On-chain L2 depth decoder** (`depth()`) so the client gets typed ladders | Makes the book usable by the UI in one call |
| 4 | **Live order-book panel in the console** — real bids/asks with depth bars | The visible moment. A judge sees the CLOB *inside* the game |
| 5 | **MON becomes a fully live market**, settled off Kuru | Proves 1–4 end to end with real money movement |
| 6 | **Spread-aware band limits** — cannot paint a band tighter than the book's spread | A range inside the spread is unsettleable; the market should say so |
| 7 | **Show the spread as a shaded zone on the chart** | Turns an abstract guard into something you can see |
| 8 | **"Priced by Kuru" provenance line** with the market address, linked | Judges check whether the integration is real |
| 9 | **Depth-weighted mid** instead of naive midpoint, when depth is lopsided | A better price, and obviously more than the minimum |
| 10 | **Book-health indicator** on the deck (tight / wide / one-sided) | Makes the guard legible during the demo |

## Tier 2 — deepening the orderbook story

| # | Idea |
|---|---|
| 11 | Settle-price provenance in the tape: "settled on Kuru mid @ block N" |
| 12 | Order-book heat: colour depth bars by size relative to the book's own median |
| 13 | Compare Kuru mid vs Binance mid live, and show the basis |
| 14 | Fall back from Kuru to keeper feed *explicitly and visibly*, never silently |
| 15 | Micro-sparkline of the spread over the last N blocks |
| 16 | Read Kuru `getMarketParams` and display tick size / min size |
| 17 | Refuse to open a market whose Kuru book has less than X depth within Y bps |
| 18 | Multi-market: wire MON-USDC as a second Kuru-priced market |
| 19 | Kuru market picker reading the Router's deployed markets |
| 20 | Cross-check the two Kuru markets for a stale-book alarm |
| 21 | Show which side of the book a settlement landed on |
| 22 | Encode band edges in tick-size units so they align to the book's grid |
| 23 | Depth snapshot stored with each ticket, for auditable settlement |
| 24 | A "book replay" on the history row: what the ladder looked like at the cutoff |
| 25 | Route an actual AUSD→MON swap through Kuru's Router for deposits |

## Tier 3 — core functional

| # | Idea |
|---|---|
| 26 | Stacking in the UI (the contract supports it; the console does not expose it) |
| 27 | Rooms UI — create/join by code (whole contract is unreachable from the app) |
| 28 | Persistent player profile in a real database |
| 29 | Achievements, awarded from real on-chain events |
| 30 | Vault/LP screen: deposit, withdraw, see utilisation and your share |
| 31 | Withdraw flow (the button exists and does nothing) |
| 32 | Settings that actually persist (sound, reduced motion, market default) |
| 33 | Account screen: address, chain, disconnect, explorer link |
| 34 | Referrals with a real on-chain attribution code |
| 35 | Shareable ticket permalink that renders the exact band and outcome |
| 36 | Open-graph card generated per ticket |
| 37 | Keyboard shortcuts in live mode (they exist only on the demo desk) |
| 38 | Touch drag for band edges on mobile |
| 39 | One-tap "repeat last band" |
| 40 | Auto-settle any due ticket you can see, not just your own |
| 41 | Batch settle from the UI using `settleBatch` |
| 42 | Per-market session P&L in the header |
| 43 | Streak counter with real consecutive-win tracking |
| 44 | Sound: a real audio engine keyed to fire/win/loss/tick |
| 45 | Haptics on mobile for fire and settle |
| 46 | Round-timer ring that counts blocks, not seconds |
| 47 | "House battery" that visibly drains as utilisation rises |
| 48 | Live vault utilisation bar in the menu |
| 49 | Position size presets as a percentage of balance |
| 50 | A practice mode that fires automatically to show the loop unattended |

## Tier 4 — design and motion

| # | Idea |
|---|---|
| 51 | Band edges that spring when clamped, so the limit is felt not just enforced |
| 52 | Settlement flash that expands from the print point on the chart |
| 53 | Coin stack that physically drops a coin on a win |
| 54 | The red key depressing with a real travel animation |
| 55 | Screen scanlines and a subtle CRT curvature on the display |
| 56 | Amber phosphor persistence trail on the price line |
| 57 | Number roll animation on the price (odometer, not a jump) |
| 58 | The band box "burning down" toward the cutoff, tied to real block progress |
| 59 | A shake on rejection (band too tight / no funds) |
| 60 | Device tilt following the cursor on desktop |
| 61 | Page transition where the console physically slides in |
| 62 | Depth bars that animate in from the mid outward |
| 63 | A confetti-free win moment — restrained, monospaced, a number that lands |
| 64 | Loading state that looks like the console booting, not a spinner |
| 65 | Reduced-motion mode that is genuinely still, not just slower |
| 66 | Dark/light that respects the viewer without breaking the cabinet look |
| 67 | The wordmark drawing itself once on first load |
| 68 | Cursor becomes a crosshair over the chart |
| 69 | Sub-pixel-crisp chart rendering on high-DPI |
| 70 | An idle attract-mode after inactivity, like a real cabinet |

## Tier 5 — production readiness

| # | Idea |
|---|---|
| 71 | Every empty state written properly (no tickets, no book, no funds, no network) |
| 72 | A real error boundary around each sheet |
| 73 | Offline detection and an honest banner |
| 74 | Wrong-network detection with a one-click switch |
| 75 | Insufficient-gas detection before firing |
| 76 | Transaction queue so two fires cannot collide on a nonce |
| 77 | Optimistic UI that reconciles against the chain and rolls back visibly |
| 78 | Retry with backoff on RPC failure, surfaced not hidden |
| 79 | Rate-limit the price endpoint |
| 80 | Cache upstream prices briefly to survive an exchange hiccup |
| 81 | Health endpoint reporting chain, keeper, and book status |
| 82 | Structured logging in the keeper |
| 83 | Keeper restart-safety (it already re-bases; make it provable) |
| 84 | Graceful degradation when the 3D model cannot render |
| 85 | Mobile viewport correctness at 375px |
| 86 | Real favicon, manifest, and PWA install |
| 87 | Meta tags and social preview |
| 88 | Accessibility pass: focus rings, labels, contrast |
| 89 | `prefers-reduced-data` respecting the tape fetch |
| 90 | A seeded demo mode for judging with no network at all |
| 91 | Deployment addresses surfaced in the UI footer |
| 92 | A single `pnpm demo` that brings up chain, contracts, keeper and app |
| 93 | Contract verification metadata in the deploy output |
| 94 | Test coverage report |
| 95 | CI workflow running the full suite |
| 96 | A README diagram of the settlement path |
| 97 | Architecture doc for the pricing model |
| 98 | Security notes: what is trusted, what is not |
| 99 | A written threat model for the oracle |
| 100 | Judge-facing one-pager with the exact commands to verify each claim |

---

## What got cut and why

Ranked low deliberately, not forgotten:

- **Perps, options surfaces, multi-leg structures** — bigger scope than the pitch, and
  they dilute "one idea, executed properly".
- **Token, points, airdrop mechanics** — the brief for this build is a market that
  works, not an incentive loop.
- **AI trade suggestions** — orthogonal to the track and instantly reads as filler.
- **Social feed / chat** — a second product.
