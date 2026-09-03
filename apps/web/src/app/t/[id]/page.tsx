import Link from "next/link";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { RangeMarketAbi } from "@xorr/sdk";

/**
 * One ticket, by id, readable by anyone.
 *
 * Rendered on the server from a contract call rather than from anything we stored, so
 * the link says what the chain says. That matters more here than convenience: a shared
 * result that came out of our own database would be a screenshot with extra steps, and
 * the entire claim of this project is that the outcome is a fact rather than a report.
 *
 * A ticket that does not exist, or a deployment with no market, says so plainly rather
 * than rendering an empty frame.
 */
export const dynamic = "force-dynamic";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const RANGE = process.env.NEXT_PUBLIC_RANGE_MARKET as Address | undefined;

const STATUS = ["open", "won", "lost", "void"] as const;

async function readTicket(id: bigint) {
  if (!RANGE) return null;
  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC) });
  try {
    // Let the ABI decide the shape; guessing it is how you end up rendering
    // `undefined` for a field the contract calls something else.
    const t = await pub.readContract({
      address: RANGE,
      abi: RangeMarketAbi,
      functionName: "getTicket",
      args: [id],
    });
    if (t.player === "0x0000000000000000000000000000000000000000") return null;
    return t;
  } catch {
    return null;
  }
}

const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
const px = (v: bigint) => (Number(v) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return {
    title: `XORR — ticket #${id}`,
    description: "A range ticket on Monad, settled at a block anyone can check.",
  };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = /^\d+$/.test(id) ? await readTicket(BigInt(id)) : null;

  if (!t) {
    return (
      <main className="tiled grid min-h-dvh place-items-center px-5">
        <div className="w-full max-w-[380px] rounded-[22px] bg-card p-6 text-center">
          <p className="text-[15px] font-semibold">No ticket #{id}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/50">
            {RANGE
              ? "This market has no ticket with that id."
              : "This deployment has no range market — the console here runs on paper."}
          </p>
          <Link
            href="/play"
            className="mt-5 inline-block rounded-full bg-amber-2 px-6 py-3 text-[13px] font-extrabold text-black"
          >
            OPEN THE CONSOLE
          </Link>
        </div>
      </main>
    );
  }

  const status = STATUS[t.status] ?? "open";
  const won = status === "won";
  const tone = won ? "text-green" : status === "lost" ? "text-red" : "text-white/70";

  return (
    <main className="tiled grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-[380px] rounded-[22px] bg-card p-6">
        <div className="label">XORR · ticket #{id}</div>

        <div className={`tnum mt-2 text-[34px] font-bold leading-none ${tone}`}>
          {status === "won"
            ? `+${usd(t.payout - t.stake)}`
            : status === "lost"
              ? `−${usd(t.stake)}`
              : status.toUpperCase()}
        </div>

        <div className="mono mt-5 space-y-2 text-[12px]">
          <Row k="Band" v={`${px(t.low)} – ${px(t.high)}`} />
          <Row k="Stake" v={usd(t.stake)} />
          <Row k="Multiplier" v={`${(t.multiplierBps / 10_000).toFixed(2)}x`} />
          <Row k="Cutoff block" v={t.expiryBlock.toLocaleString()} />
          {t.settledPrice > 0n ? <Row k="Printed at" v={px(t.settledPrice)} /> : null}
          <Row k="Owner" v={`${t.player.slice(0, 6)}…${t.player.slice(-4)}`} />
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-white/40">
          Read from the market contract on chain {CHAIN_ID}, not from a database. The
          cutoff is a block number, so this outcome is a fact rather than a report of
          one.
        </p>

        <Link
          href="/play"
          className="mt-5 block rounded-full bg-amber-2 py-3 text-center text-[13px] font-extrabold text-black"
        >
          PLAY A ROUND
        </Link>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-dim">{k}</span>
      <span className="tnum text-white/80">{v}</span>
    </div>
  );
}
