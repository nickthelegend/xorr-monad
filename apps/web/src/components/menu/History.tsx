"use client";

import { fmtMultiplier, fmtPrice, fmtUsd, marketByKey, type PaperTicket } from "@xorr/sdk";

export function History({ tickets }: { tickets: PaperTicket[] }) {
  if (tickets.length === 0) {
    return (
      <p className="py-16 text-center text-[14px] text-white/40">
        No plays yet.
        <br />
        Pick a band and hit the red key.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {[...tickets].reverse().map((t) => {
        const m = marketByKey(t.marketKey);
        const dp = m?.dp ?? 2;
        const tone =
          t.status === "won" ? "text-green" : t.status === "lost" ? "text-red" : "text-white/60";
        return (
          <div key={t.id} className="rounded-2xl bg-[#141414] px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold">
                {m?.symbol ?? t.marketKey}{" "}
                <span className="text-white/35">#{t.id}</span>
                {t.parentId ? (
                  <span className="ml-1 text-[11px] text-amber">stacked on #{t.parentId}</span>
                ) : null}
              </span>
              <span className={`tnum text-[15px] font-bold ${tone}`}>
                {t.status === "won"
                  ? `+${fmtUsd(t.payout - t.stake)}`
                  : t.status === "lost"
                    ? `−${fmtUsd(t.stake)}`
                    : t.status === "void"
                      ? "void"
                      : "open"}
              </span>
            </div>
            <div className="tnum mt-1 flex justify-between text-[11px] text-white/40">
              <span>
                {fmtPrice(t.low, dp)} – {fmtPrice(t.high, dp)}
              </span>
              <span>
                {fmtUsd(t.stake)} @ {fmtMultiplier(t.multiplierBps)}
              </span>
            </div>
            <div className="mono mt-1 text-[10px] tracking-wide text-white/25">
              cutoff block {t.expiryBlock.toLocaleString()}
              {t.settledPrice !== null ? ` · printed ${fmtPrice(t.settledPrice, dp)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
