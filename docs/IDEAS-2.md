# 100 more ideas, ranked

A second pass, written after the first hundred were built or cut. Nothing already in
the repo is proposed again — this list starts where `docs/IDEAS.md` and `PLAN.md` end.

Scored **impact × feasibility × fit**, where fit means "sharpens the on-chain order book
pitch" rather than "adds a feature". A hundred disconnected features hurt a demo; the
ranking is the honest part of this document.

The single question a judge will ask about a derivative settled on an order book is
**"what stops someone moving the book at the cutoff block?"** Everything in Tier 1
exists to answer it, and the top item answers it structurally rather than with a guard.

---

## Tier 1 — answer the hardest question about this design

| # | Idea | Why it ranks here |
|---|---|---|
| 1 | **TWAP mark: settle on the time-weighted mid across the round, not the instant at the cutoff** | The structural answer. A single-block mark is manipulable by whoever controls the cutoff block; an average over every block of the round costs the attacker the whole round to move. This is the difference between guarding against manipulation and pricing it out. |
| 2 | **Manipulation-cost calculator** — walk the real ladder and price, in dollars, what it would take to push the mark far enough to flip a given band | Turns "we have guards" into a number a judge can check against the book on screen. |
| 3 | **On-chain settlement receipt** — emit the mark, spread and depth at the settling block | Makes the conditions of every settlement auditable from events alone, with nothing to trust from us. |
| 4 | **Depth inside your band** — how much size actually rests between the two edges you painted | Connects the band directly to the book. Nobody else's range product can show this. |
| 5 | **"Why this price" trace** — `bestBidAsk` → each guard in order → the mark, with real numbers at this block | The oracle's reasoning, shown rather than described. |
| 6 | **Book pressure** — resting bid size vs ask size as one bar on the deck | One glance at which way the book leans, on the screen the whole time. |
| 7 | **Impact preview** — what a trade the size of the open interest would actually fill at, walked through the ladder | Uses the order-book maths already in the SDK for something a player cares about. |
| 8 | **Touch-moved-in-window flag** — say when the top of book changed during the settle window | The honest disclosure that a book can move under a settlement. |
| 9 | **Settle-block book snapshot on the ticket page** | The permalink already reads the chain; reading the ladder at that block makes the receipt complete. |
| 10 | **Spread-aware band floor** — refuse a band tighter than the book's own spread | A range inside the spread cannot be settled meaningfully. The market should say so. |

## Tier 2 — functional depth a judge would use

| # | Idea |
|---|---|
| 11 | Cash out before the cutoff at a fair mid-round price |
| 12 | Auto-roll: on settle, re-open the same band immediately |
| 13 | Take this trade — open the band from a shared ticket permalink |
| 14 | Limit open: fire only when the price first touches X |
| 15 | Two bands at once (straddle the mark) |
| 16 | Leaderboard ranked by return on stake, not absolute P&L |
| 17 | Vault epoch report: what LPs actually earned over N blocks |
| 18 | Per-market page: spread, depth, realised vol, edge |
| 19 | Open interest by band, as a heat strip on the chart |
| 20 | Your position vs the crowd — where other open bands sit |
| 21 | A public settle bounty so anyone is paid to poke expired tickets |
| 22 | Ticket expiry countdown in the browser tab title |
| 23 | Web push when your ticket settles |
| 24 | Withdraw queue when the vault is above its utilisation cap |
| 25 | Vault share price chart over time |
| 26 | Per-round realised-vs-modelled table, live |
| 27 | Export your tape as CSV |
| 28 | Keyboard-only full play loop, documented |
| 29 | Undo the last band nudge |
| 30 | A second stake rail detent for "all in, capped" |

## Tier 3 — design and motion that a judge remembers

| # | Idea |
|---|---|
| 31 | Band edges rubber-band when they hit the clamp |
| 32 | Phosphor persistence trail behind the price line |
| 33 | CRT curvature and scanlines on the screen glass |
| 34 | Device tilts toward the cursor on desktop |
| 35 | The wordmark draws itself once on first load |
| 36 | A coin physically drops into the stack on a win |
| 37 | The fire key travels and rebounds |
| 38 | Distinct sound for win, loss, settle and refusal |
| 39 | The console slides in on first navigation |
| 40 | Crosshair cursor over the chart |
| 41 | The ladder's rows shift as levels are consumed |
| 42 | Depth bars animate outward from the mid |
| 43 | The mark ticks with a tiny physical step, not a fade |
| 44 | The band box breathes very slightly while open |
| 45 | Idle attract screensaver after long inactivity |
| 46 | Ticket settles with the ring, the sound and the coin in sequence |
| 47 | A subtle vignette that darkens as the cutoff approaches |
| 48 | Theme transition animates rather than cuts |
| 49 | The house battery drains cell by cell, not smoothly |
| 50 | A "printed" stamp on a settled history row |
| 51 | Haptics on mobile for fire and settle |
| 52 | The Kuru strip pulses when the touch changes |
| 53 | Number roll on the multiplier, not just the price |
| 54 | The 3D console reacts to a win |
| 55 | Loading the book shows the ladder filling in |

## Tier 4 — production readiness

| # | Idea |
|---|---|
| 56 | Wrong-network banner with a one-click switch |
| 57 | Pending-transaction indicator with the nonce |
| 58 | Visible retry countdown on RPC failure |
| 59 | Rate-limit `/api/kuru` and `/api/leaderboard` as `/api/price` already is |
| 60 | `prefers-reduced-data`: skip the tape fetch, price only |
| 61 | Skip-link and focus trap in the sheets |
| 62 | Screen-reader live region for settlements |
| 63 | A real 404 page in the console's voice |
| 64 | Health check wired into CI on the deployed URL |
| 65 | Client error boundary reporting to a real endpoint |
| 66 | Bundle size budget enforced in CI |
| 67 | Lighthouse run in CI |
| 68 | Contract size and gas snapshot in CI |
| 69 | A `pnpm doctor` that diagnoses a broken local setup |
| 70 | Deterministic seed for the paper desk, for reproducible demos |
| 71 | Graceful degradation when Coinbase (the basis source) is down |
| 72 | Stale-tab detection: say when the desk has been backgrounded |
| 73 | An explicit "this is a fork" banner in live mode |
| 74 | Contract addresses linkable to an explorer where one exists |
| 75 | Structured request logging on the API routes |

## Tier 5 — the pitch itself

| # | Idea |
|---|---|
| 76 | A one-screen architecture diagram inside the app |
| 77 | An in-app "verify this yourself" sheet with the commands |
| 78 | Numbers in the README generated from a live run, not typed |
| 79 | A short written FAQ of the hardest questions and honest answers |
| 80 | Judge mode: a URL that opens the console pre-armed for a demo |
| 81 | A changelog of every bug the verification pass found |
| 82 | Screenshot set generated from the running app |
| 83 | The threat model as its own page |
| 84 | A comparison table: feed-settled vs book-settled |
| 85 | The measured T(0) shown as a chart |
| 86 | Sigma term structure plotted |
| 87 | Realised vs modelled win rate, plotted per round |
| 88 | An honest "what would break this" section |
| 89 | Gas cost per fire and settle, measured |
| 90 | Where the 4% fee actually goes |

## Tier 6 — ranked low, deliberately

| # | Idea | Why low |
|---|---|---|
| 91 | Perps on the same book | Different product; dilutes one idea executed properly |
| 92 | Options surface | Same |
| 93 | Points or a token | The brief is a market that works |
| 94 | Social feed | A second product |
| 95 | AI trade suggestions | Reads as filler |
| 96 | Multi-chain deploy | Nothing to prove; Monad's block time is the point |
| 97 | Mobile native app | Web is the demo |
| 98 | Tournament mode | Rooms already covers player-vs-player |
| 99 | NFT of a winning ticket | The permalink is the artifact |
| 100 | Referral rewards | Incentive loops, not a market |

---

## Build order

Tier 1 in order, then Tier 2 by rank, then whatever of Tiers 3–5 the time allows.
Tier 6 is not built on purpose, and saying so is part of the point.
