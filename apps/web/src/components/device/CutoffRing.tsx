"use client";

/**
 * How long a ticket has left, counted in blocks.
 *
 * Not seconds. The cutoff is a block number — that is the whole conceit of the market,
 * and a clock counting down in seconds would quietly misrepresent it. On a chain that
 * settles every 300ms the two look similar until the chain hiccups, and then only one
 * of them is telling the truth.
 *
 * The ring drains rather than fills, so "nearly gone" reads at a glance, and the number
 * in the middle is the literal count of blocks remaining.
 */
const SIZE = 34;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function CutoffRing({
  openBlock,
  expiryBlock,
  block,
}: {
  openBlock: number;
  expiryBlock: number;
  block: number;
}) {
  const total = Math.max(1, expiryBlock - openBlock);
  const left = Math.max(0, expiryBlock - block);
  const remaining = Math.max(0, Math.min(1, left / total));

  // Under a fifth of the round left is where a player starts caring.
  const urgent = remaining <= 0.2;
  const tone = urgent ? "var(--color-red)" : "var(--color-amber)";

  return (
    <span
      className="relative inline-grid place-items-center"
      style={{ width: SIZE, height: SIZE }}
      role="timer"
      aria-label={`${left} blocks until cutoff`}
      title={`${left} of ${total} blocks left`}
    >
      <svg width={SIZE} height={SIZE} className="absolute -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#1e1e1e" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={tone}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - remaining)}
          // 300ms is one block, so the sweep lands exactly as the next one arrives.
          style={{ transition: "stroke-dashoffset 300ms linear, stroke 200ms ease" }}
        />
      </svg>
      <span
        className={`tnum relative text-[10px] font-bold leading-none ${urgent ? "text-red" : "text-amber"}`}
      >
        {left}
      </span>
    </span>
  );
}
