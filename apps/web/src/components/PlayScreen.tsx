"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  ROUND_BLOCKS,
  fmtMultiplier,
  fmtPrice,
  fmtUsd,
  payoutFor,
  roundLabel,
} from "@xorr/sdk";
import { usePaperDesk } from "@/lib/usePaperDesk";
import { useBand } from "@/lib/useBand";
import { usePrefs, useApplyTheme, usePrefersReducedMotion } from "@/lib/usePrefs";
import { useSound } from "@/lib/useSound";
import { DeviceFrame } from "./device/DeviceFrame";
import { RangeChart } from "./device/RangeChart";
import { BlueKey, CoinKey, CoinStack, DeckKey, FireKey } from "./device/Controls";
import { BookStrip } from "./device/BookStrip";
import { MenuSheet } from "./menu/MenuSheet";
import { HowToSheet } from "./menu/HowToSheet";
import { LiveConsole } from "./LiveConsole";
import { LIVE_CONFIGURED } from "@/lib/chain";

/** Stake ladder, in 6-decimal asset units. The contract accepts $1 to $10. */
const STAKE_STEPS = [1_000_000n, 1_500_000n, 2_000_000n, 3_000_000n, 5_000_000n, 10_000_000n];

const COIN_TONE: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#8098ee",
  MON: "#836ef9",
};

export function PlayScreen() {
  const router = useRouter();
  const { prefs, set: setPref, loaded: prefsLoaded } = usePrefs();
  const osReduced = usePrefersReducedMotion();
  const reducedMotion = prefs.reducedMotion || osReduced;

  useApplyTheme(prefs.theme);

  const desk = usePaperDesk(prefs.market);
  const { state, setMarketKey, setTier, setRunning, fire, reset } = desk;
  const band = useBand(state.market, state.tier, state.spot);
  const play = useSound(prefs.sound);

  const [stakeStep, setStakeStep] = useState(2); // $1.5
  const [sheet, setSheet] = useState<null | "menu" | "howto">(null);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState<null | { kind: "won" | "lost"; text: string }>(null);

  /**
   * Open on the market and round the player last chose.
   *
   * This waits for `prefsLoaded`: stored preferences arrive a tick after mount, so
   * applying them on first render would only ever re-apply the defaults and then stop.
   */
  const [appliedDefaults, setAppliedDefaults] = useState(false);
  useEffect(() => {
    if (appliedDefaults || !prefsLoaded) return;
    if (prefs.market !== state.market.key) setMarketKey(prefs.market);
    if (prefs.tier !== state.tier) setTier(prefs.tier);
    setAppliedDefaults(true);
  }, [
    appliedDefaults,
    prefsLoaded,
    prefs.market,
    prefs.tier,
    state.market.key,
    state.tier,
    setMarketKey,
    setTier,
  ]);

  /**
   * Click once when sound is switched on.
   *
   * Doing this inside the toggle handler is silent: the sound engine is built from the
   * value at render time, so the click fires against the state that was there a moment
   * ago. Waiting for the render that has it on is what makes the confirmation audible.
   */
  const wasSilent = useRef(true);
  useEffect(() => {
    if (prefs.sound && wasSilent.current) play("key");
    wasSilent.current = !prefs.sound;
  }, [prefs.sound, play]);

  const stake = STAKE_STEPS[stakeStep - 1];
  const payout = payoutFor(stake, band.multiplierBps);
  const round = state.market.rounds[state.tier];

  // Progress of the nearest open ticket toward its cutoff, for the burn overlay.
  const progress = useMemo(() => {
    const t = state.openTickets[0];
    if (!t) return 0;
    const total = Math.max(1, t.expiryBlock - t.openBlock);
    return Math.max(0, Math.min(1, (state.block - t.openBlock) / total));
  }, [state.openTickets, state.block]);

  // Announce settlements on the screen the way the console would.
  useEffect(() => {
    const t = state.lastSettled;
    if (!t || t.status === "open") return;
    setFlash({
      kind: t.status === "won" ? "won" : "lost",
      text: t.status === "won" ? `+${fmtUsd(t.payout - t.stake)}` : `−${fmtUsd(t.stake)}`,
    });
    // A bigger win rings brighter — the sound reports the size, not just the outcome.
    play(
      t.status === "won" ? "win" : "loss",
      t.status === "won" ? Math.min(1, Number(t.payout - t.stake) / Number(t.stake) / 4) : 0.5,
    );
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [state.lastSettled]);

  const doFire = useCallback(() => {
    const r = fire(band.low, band.high, stake);
    if (r.ok) play("fire");
    if (!r.ok) {
      play("reject");
      const e = r.error;
      setFlash({
        kind: "lost",
        text:
          e.kind === "band-too-wide"
            ? "BAND TOO WIDE"
            : e.kind === "band-too-tight"
              ? "BAND TOO TIGHT"
              : e.kind === "balance"
                ? "NO FUNDS"
                : e.kind === "over-utilised"
                  ? "HOUSE FULL"
                  : "CAN'T FIRE",
      });
      setTimeout(() => setFlash(null), 1400);
    }
  }, [fire, band.low, band.high, stake, play]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "a" || e.key === "A" || e.key === "Enter") {
        e.preventDefault();
        doFire();
      } else if (e.key === "[") {
        band.nudge(-0.08);
        play("key");
      } else if (e.key === "]") {
        band.nudge(0.08);
        play("key");
      }
      else if (e.key === "m" || e.key === "M") setSheet("menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFire, band, play]);

  const coins = Math.round(Number(state.balance) / 25_000_000); // one coin per $25

  // The console opens on paper: a first round in under fifteen seconds, no wallet and
  // nothing to fund. Live is one key away and runs identical pricing.
  if (live) return <LiveConsole onBackToDemo={() => setLive(false)} />;

  return (
    <div className="tiled min-h-dvh">
      <DeviceFrame
        stakeStep={stakeStep}
        maxStake={STAKE_STEPS.length}
        onStakeStep={setStakeStep}
        soundOn={prefs.sound}
        onToggleSound={() => setPref("sound", !prefs.sound)}
        running={state.running}
        onToggleRunning={() => setRunning(!state.running)}
      >
        {/* ------------------------------------------------------- main screen */}
        <div className="screen rounded-xl px-4 pb-2 pt-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="label">Range · {state.market.symbol}</div>
              <div className="tnum mt-1 text-[30px] font-bold leading-none text-white">
                {state.ready ? fmtPrice(state.spot, state.market.dp) : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="label">Available</div>
              <div className="tnum mt-1 text-[15px] font-semibold text-white">
                {fmtUsd(state.balance)}
              </div>
            </div>
          </div>

          <div className="relative mt-3 h-[228px]">
            {!state.ready ? (
              <div className="grid h-full place-items-center px-6 text-center">
                <span className="label leading-relaxed">
                  {state.priceError
                    ? `no ${state.market.symbol} price: ${state.priceError}`
                    : `fetching the real ${state.market.symbol} price`}
                </span>
              </div>
            ) : (
            <RangeChart
              market={state.market}
              history={state.history}
              spot={state.spot}
              low={band.low}
              high={band.high}
              multiplierBps={band.multiplierBps}
              progress={reducedMotion ? 0 : progress}
              openBands={state.openTickets.map((t) => ({
                low: t.low,
                high: t.high,
                won: state.spot >= t.low && state.spot <= t.high,
              }))}
              onDragEdge={band.setEdge}
            />
            )}

            {flash ? (
              <div
                className={`pop pointer-events-none absolute inset-0 grid place-items-center text-[34px] font-bold ${
                  flash.kind === "won" ? "text-green glow-green" : "text-red"
                }`}
              >
                {flash.text}
              </div>
            ) : null}
          </div>

          {/* round selector, on the glass */}
          <div className="mt-1 flex items-center justify-between border-t border-[#161616] pt-2">
            <span className="label">Cutoff</span>
            <div className="flex gap-1">
              {ROUND_BLOCKS.map((b, i) => (
                <button
                  key={b}
                  onClick={() => {
                    setTier(i);
                    setPref("tier", i);
                    play("key");
                  }}
                  className={`mono rounded px-1.5 py-0.5 text-[10px] tracking-wide ${
                    i === state.tier ? "bg-amber text-black" : "text-dim hover:text-white"
                  }`}
                >
                  {roundLabel(i)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Kuru's book, on the deck, for the market XORR prices from it. */}
        {state.market.key === "MON" ? <BookStrip onOpen={() => setSheet("menu")} /> : null}

        {/* --------------------------------------------- pays panel + fire key */}
        <div className="mt-2 flex gap-2">
          <div className="screen flex-1 rounded-xl px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="label">Pays</span>
              <span className="tnum text-[13px] text-white">
                {fmtUsd(stake)} <span className="text-dim">→</span>{" "}
                <span className="text-green">{fmtUsd(payout)}</span>
              </span>
            </div>

            <div className="tnum glow-amber mt-1 text-[34px] font-bold leading-none text-amber">
              {state.ready ? fmtMultiplier(band.multiplierBps) : "—"}
            </div>

            {/* No win-probability on the deck. The number the model prices from is
                deliberately conservative — sigma is shaded so the vault stays solvent
                through a volatility regime change — so it is not a truthful forecast to
                put in front of a player. The multiplier is the actual contract; the
                model and its bias are explained in How it works. */}
            <p className="mono mt-2 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
              STACK AS MANY AS YOU LIKE.
              <br />
              THEY ALL SETTLE AT THE
              <br />
              CUTOFF · {round.seconds}S ROUND
            </p>
          </div>

          <FireKey onClick={doFire} disabled={!state.ready} armed={state.openTickets.length > 0} />
        </div>

        {/* ------------------------------------------------------- lower deck */}
        <div className="mt-2 flex items-stretch gap-2">
          <BlueKey onClick={() => (LIVE_CONFIGURED ? setLive(true) : setSheet("howto"))}>
            {LIVE_CONFIGURED ? "GO LIVE" : "HOW TO"}
          </BlueKey>
          <CoinKey
            symbol={state.market.symbol}
            tone={COIN_TONE[state.market.key] ?? "#f7931a"}
            onClick={() => {
              const i = MARKETS.findIndex((m) => m.key === state.market.key);
              const next = MARKETS[(i + 1) % MARKETS.length].key;
              setMarketKey(next);
              setPref("market", next);
              play("key");
            }}
          />
          <CoinStack count={coins} />
        </div>

        <div className="mt-3 flex items-end justify-between px-1 pb-1">
          <div className="flex gap-3">
            <DeckKey label="MENU" onClick={() => setSheet("menu")} />
            <DeckKey label="HOME" onClick={() => router.push("/")} />
          </div>
          <div className="tnum rounded-lg bg-black px-3 py-2 text-[15px] font-semibold text-white">
            {fmtUsd(stake, Number(stake) % 1_000_000 === 0 ? 0 : 1)}
          </div>
        </div>
      </DeviceFrame>

      {sheet === "menu" ? (
        <MenuSheet
          onClose={() => setSheet(null)}
          balance={state.balance}
          tickets={state.tickets}
          pnl={state.pnl}
          onReset={reset}
        />
      ) : null}
      {sheet === "howto" ? <HowToSheet onClose={() => setSheet(null)} round={round} /> : null}
    </div>
  );
}
