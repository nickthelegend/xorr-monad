"use client";

import { useEffect, useState } from "react";

interface Level {
  price: number;
  size: number;
}

interface Book {
  configured: boolean;
  market?: string;
  oracle?: string;
  onchain?: {
    block: string;
    bid: number;
    ask: number;
    mid: number;
    spreadBps: number;
    bids: Level[];
    asks: Level[];
    marks?: {
      mid: number;
      micro: number;
      topBidSize: number;
      topAskSize: number;
      mark: "MID" | "MICRO";
      microGuarded: boolean;
      dustFloor: number;
    };
  };
  params?: { tickSize: number; minSize: number; maxSize: number; takerFeeBps: number };
  health?: string;
  tradeable?: boolean;
  reason?: string;
  venue?: {
    lastPrice: number | null;
    lastTradeTime: string | null;
    volume24h: number | null;
    trades24h: number | null;
    traders24h: number | null;
    volume1h: number | null;
    tickSize: number | null;
    base: string | null;
    quote: string | null;
  } | null;
  error?: string;
}

const HEALTH: Record<string, { tone: string; label: string }> = {
  tight: { tone: "text-green", label: "TIGHT" },
  wide: { tone: "text-amber", label: "WIDE" },
  thin: { tone: "text-amber", label: "THIN" },
  resting: { tone: "text-amber", label: "RESTING" },
  quiet: { tone: "text-amber", label: "QUIET" },
  "one-sided": { tone: "text-red", label: "ONE-SIDED" },
  crossed: { tone: "text-red", label: "CROSSED" },
};

const px = (v: number) => v.toFixed(6);
/**
 * Sizes, at the precision the number is actually about.
 *
 * One decimal is right for a ladder of three-hundred-MON rests and wrong for the dust
 * order the guard exists to reject: 0.000138 MON printed as "0.0" reads as an empty
 * side, which is a different claim entirely.
 */
const sz = (v: number) => {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v === 0) return "0";
  if (v < 0.1) return v.toPrecision(2);
  return v.toFixed(1);
};

/**
 * Kuru's order book, as the contract sees it.
 *
 * Every number under the ladder came from a contract call at the block shown — the
 * same call XORR's oracle makes to price the market. It is deliberately not a REST
 * snapshot dressed up as one.
 */
export function OrderBook() {
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/kuru", { cache: "no-store" });
        const j = (await r.json()) as Book;
        if (stop) return;
        if (!r.ok) setErr(j.error ?? `book unavailable (${r.status})`);
        else setErr(null);
        setBook(j);
      } catch (e) {
        if (!stop) setErr((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (err && !book?.onchain) {
    return <p className="mt-8 text-center text-[13px] text-red">{err}</p>;
  }
  if (!book) {
    return <p className="label mt-8 text-center">reading the book</p>;
  }
  if (!book.configured) {
    return (
      <p className="mt-8 text-center text-[13px] leading-relaxed text-white/45">
        No Kuru oracle is deployed for this environment.
        <br />
        Deploy with KURU_MON_AUSD set to read the book.
      </p>
    );
  }

  const b = book.onchain;
  if (!b) return <p className="label mt-8 text-center">no book</p>;

  const asks = [...b.asks].slice(0, 7).reverse();
  const bids = b.bids.slice(0, 7);
  const maxSize = Math.max(1, ...b.asks.map((l) => l.size), ...b.bids.map((l) => l.size));
  const health = HEALTH[book.health ?? ""] ?? { tone: "text-dim", label: "—" };

  return (
    <div className="pb-6">
      {/* ---- top of book */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="label">
              {book.venue?.base ?? "MON"} / {book.venue?.quote ?? "AUSD"} · Kuru
            </div>
            <div className="tnum mt-1 text-[26px] font-bold leading-none text-white">
              {px(b.mid)}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Spread</div>
            <div className="tnum mt-1 text-[15px] font-semibold text-amber">
              {b.spreadBps} bps
            </div>
          </div>
        </div>

        <div className="mono mt-3 flex items-center gap-2 text-[10px] tracking-[0.08em]">
          <span className={`rounded px-1.5 py-0.5 ${health.tone} bg-white/5`}>
            {health.label}
          </span>
          <span className="tnum text-dim">block {b.block}</span>
        </div>

        {book.reason ? (
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">{book.reason}</p>
        ) : null}

        {/* How this book becomes one number, and which rule is in force right now. */}
        {b.marks ? <MarkExplainer marks={b.marks} /> : null}
      </div>

      {/* ---- the ladder */}
      <div className="mono mt-3 overflow-hidden rounded-2xl bg-[#0d0d0d]">
        <div className="flex items-center justify-between px-3 py-2 text-[9px] tracking-[0.12em] text-dim">
          <span>PRICE</span>
          <span>SIZE ({book.venue?.base ?? "MON"})</span>
        </div>

        {asks.map((l, i) => (
          <Row key={`a${i}`} level={l} max={maxSize} side="ask" />
        ))}

        <div className="flex items-center justify-between border-y border-white/10 bg-[#161616] px-3 py-2">
          <span className="tnum text-[12px] font-bold text-white">{px(b.mid)}</span>
          <span className="label">mid</span>
        </div>

        {bids.map((l, i) => (
          <Row key={`b${i}`} level={l} max={maxSize} side="bid" />
        ))}
      </div>

      {/* ---- venue activity, clearly separated from anything used for pricing */}
      {book.venue ? (
        <div className="mt-3 rounded-2xl bg-[#141414] p-4">
          <div className="label">Venue activity · Kuru API</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="24h volume" value={fmtNum(book.venue.volume24h)} />
            <Stat label="24h trades" value={fmtNum(book.venue.trades24h)} />
            <Stat label="1h volume" value={fmtNum(book.venue.volume1h)} />
            <Stat label="24h traders" value={fmtNum(book.venue.traders24h)} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            These aggregates come from Kuru&apos;s API and are never used to price
            anything. The ladder above is read from the chain.
          </p>
        </div>
      ) : null}

      {/* ---- the venue's own rules */}
      {book.params ? (
        <div className="mt-3 rounded-2xl bg-[#141414] p-4">
          <div className="label">Market rules · read from the book</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="Tick size" value={book.params.tickSize.toFixed(6)} />
            <Stat label="Taker fee" value={`${book.params.takerFeeBps} bps`} />
            <Stat label="Min order" value={`${fmtNum(book.params.minSize)} MON`} />
            <Stat label="Max order" value={`${fmtNum(book.params.maxSize)} MON`} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            A band narrower than one tick cannot be traded against, so nothing here is
            hard-coded — the venue is free to change these and the market follows.
          </p>
        </div>
      ) : null}

      {/* ---- provenance */}
      <div className="mt-3 rounded-2xl bg-[#141414] p-4">
        <div className="label">Provenance</div>
        <Addr label="Kuru market" value={book.market} />
        <Addr label="XORR oracle" value={book.oracle} />
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">
          XORR&apos;s MON mark is{" "}
          {book.onchain?.marks?.mark === "MICRO"
            ? "the size-weighted midpoint of these resting orders"
            : "the midpoint of these resting orders"}
          , read on-chain by <span className="text-white">KuruOracle</span>. No relayer,
          no API, nothing off-chain between the venue and the price.
        </p>
      </div>
    </div>
  );
}

function Row({ level, max, side }: { level: Level; max: number; side: "bid" | "ask" }) {
  const pct = Math.max(2, (level.size / max) * 100);
  const tone = side === "bid" ? "text-green" : "text-red";
  const bar = side === "bid" ? "bg-green/15" : "bg-red/15";
  return (
    <div className="relative flex items-center justify-between px-3 py-[7px]">
      {/* Depth as width, so relative size is readable without reading a number. */}
      <span
        className={`absolute inset-y-0 right-0 ${bar}`}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <span className={`tnum relative text-[11px] ${tone}`}>{px(level.price)}</span>
      <span className="tnum relative text-[11px] text-white/70">{sz(level.size)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tnum mt-0.5 text-[14px] font-semibold text-white">{value}</div>
    </div>
  );
}

function Addr({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="mt-2 flex items-baseline justify-between gap-3">
      <span className="label shrink-0">{label}</span>
      <span className="tnum truncate text-[11px] text-white/70">{value}</span>
    </div>
  );
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Which rule turns the book into a price, stated rather than implied.
 *
 * Showing this only when the microprice happens to differ from the midpoint reads as
 * "the mark is the midpoint" on every book where the two agree — which is exactly the
 * case when the dust guard has just overridden the weighting. The interesting state is
 * the guard firing, so name the configured rule in every state and say when it was
 * overridden and why.
 */
function MarkExplainer({
  marks,
}: {
  marks: NonNullable<NonNullable<Book["onchain"]>["marks"]>;
}) {
  const differs = Math.abs(marks.micro - marks.mid) > 1e-9;
  const gapBps = marks.mid > 0 ? (Math.abs(marks.micro - marks.mid) / marks.mid) * 10_000 : 0;

  if (marks.mark === "MID") {
    return (
      <div className="mt-3 rounded-xl bg-[#0d0d0d] p-3">
        <div className="flex items-baseline justify-between">
          <span className="label">Midpoint · used</span>
          <span className="tnum text-[13px] font-semibold text-amber">{px(marks.mid)}</span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          This book is marked on the plain midpoint of best bid and best ask —{" "}
          {sz(marks.topBidSize)} against {sz(marks.topAskSize)}. Resting size is not
          weighted in.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-[#0d0d0d] p-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Midpoint</span>
        <span className="tnum text-[12px] text-white/50">{px(marks.mid)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="label">
          Microprice{marks.microGuarded ? " · guarded" : " · used"}
        </span>
        <span
          className={`tnum text-[13px] font-semibold ${
            marks.microGuarded ? "text-white/50" : "text-amber"
          }`}
        >
          {px(marks.micro)}
        </span>
      </div>

      {marks.microGuarded ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          This book is marked on the size-weighted midpoint, but one side is dust —{" "}
          {sz(marks.topBidSize)} on the bid against {sz(marks.topAskSize)} on the ask,
          under the {sz(marks.dustFloor)} floor. Weighting against that would let a
          fraction of a MON move the mark, so the oracle falls back to the plain
          midpoint until the side is real again.
        </p>
      ) : differs ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          {sz(marks.topBidSize)} rests on the bid against {sz(marks.topAskSize)} on the
          ask, so a midpoint between them is a price neither side would trade at. The
          mark is weighted toward the thinner side — {gapBps.toFixed(0)} bps from the
          midpoint.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          {sz(marks.topBidSize)} rests on the bid against {sz(marks.topAskSize)} on the
          ask. The sides are balanced enough that weighting by size lands on the
          midpoint anyway.
        </p>
      )}
    </div>
  );
}
