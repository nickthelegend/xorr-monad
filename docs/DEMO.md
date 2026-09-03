# XORR — demo script

Three minutes. The point to land is that a three-second market is only possible on a
chain that settles in 300ms, and that everything on screen is real.

## Before you start

```
pnpm demo
```

That forks Monad mainnet at 300ms, deploys with Kuru's book wired in, funds the vault
from a real AUSD holder, starts the keeper and serves the console — waiting for each
step to actually answer before moving to the next. It refuses to continue if the deploy
came back without a Kuru oracle, or holding anything other than real Agora AUSD.

It prints a health line at the end. Check it before you present:

```
curl -s localhost:3000/api/health
```

`chain`, `keeper` and `book` are reported separately, because a demo fails differently
for each. The keeper's status is measured from the age of its last on-chain print, not
from asking it whether it is alive.

---

## 0:00 — the landing

Open `/`. One line: **"Built for fun and money."**

> "This is a console. You paint a range around the price, and if the price is still
> inside it a few seconds later, you get paid."

Don't linger.

## 0:20 — the first round, on paper

Hit **START**. No wallet, no funding, no signature.

> "It opened on the real BTC price and it's replaying real one-second market tape.
> The band is the amber box. Tighter pays more."

Press `]` twice — the multiplier falls. Press `[` four times — it climbs.

> "That number is the actual contract price for that band. Not an estimate of it."

Hit **30s**, then the red key. Watch the band project out and burn down to the cutoff.

## 1:00 — why this needs Monad

Switch to the **3s** round and fire again.

> "Three seconds is ten blocks. That's the whole thing — on a chain with two-second
> blocks this round doesn't exist, and on a chain with twelve-second blocks it's a
> joke. The cutoff is a block number, not a timer."

## 1:30 — the part that isn't obvious

Open **Menu → How it works**, and read the multiplier section out loud.

> "Over a three-second round, BTC often doesn't move at all — the same tick prints at
> both ends. A bell curve says that has probability zero. Price a tight band off a bell
> curve and you hand out a multiplier you can't cover.
>
> So every round carries a distribution measured from real tape. It's on-chain, and the
> Solidity and the TypeScript are diffed on 1,728 quotes every test run."

Then the honesty beat:

> "And the fee is 4%, but the real spread is wider. We estimate volatility off the quiet
> end of recent windows and quote the win-rate table at the high end of them, so the
> vault survives a regime change — and that costs something. Replayed across four
> separate stretches of held-out tape the real edge ran from about 3% to about 42%,
> depending far more on how volatile that stretch was than on the round length. It's
> written on the screen. That's also why there's no win percentage on the deck: the
> model's number is a pricing input, not a forecast."

## 2:15 — live, on chain

Back on the desk, hit **GO LIVE**, connect, fire.

> "Real AUSD — the Agora token, on a fork of Monad mainnet. Real signed transaction."

Point at the block height ticking, then the hash in the footer.

> "Settlement is a public transaction. Anyone can poke an expired ticket; the keeper
> just makes sure somebody does. The vault reserved the **full payout** the moment this
> opened, so if every open ticket wins, every one gets paid."

Open **Menu → Leaderboard → TOP REKT**.

> "Those rows are aggregated from settlement events on the deployed market. If nobody
> has settled a ticket, the board is empty — it never invents players."

## 2:45 — close

> "Contracts, pricing, calibration, the keeper, the console. The distribution is
> measured rather than assumed, the vault reserves the full payout, and the spread is
> stated rather than hidden."

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Desk says "fetching the real BTC price" | Binance unreachable | It will not invent one. Check the network. |
| Live console says "chain unreachable" | anvil died | `pnpm demo --fresh` |
| Price frozen on the live desk | keeper stopped | `/api/health` says so; `tail .xorr-logs/keeper.log` |
| Fire does nothing | wallet on the wrong chain | The console asks the wallet to switch to 143 |

## Questions you will get

**"Is this gambling?"** — It is a short-dated range option, settled on a public feed at a
published block. The pricing model and its bias are on the screen, the vault's exposure
is on-chain, and the spread is stated.

**"What stops the house going bust?"** — The vault reserves the full payout at open, not
the profit. `test_VaultCanAlwaysPayEveryOpenTicketEvenIfAllWin` fires twenty tickets,
wins all twenty, and pays all twenty. Utilisation is capped at 80%.

**"What if the oracle dies?"** — Inside the staleness window, settlement reverts rather
than settling on an untrusted price. Past it, the ticket voids and the stake is refunded
in full.

**"Could someone stack a certain outcome right before the cutoff?"** — No. Stacking
reprices against the blocks remaining, and a band that has become a near-certainty is
refused for being too tight to sell.
