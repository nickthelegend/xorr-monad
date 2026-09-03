import { NextResponse } from "next/server";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { KuruOracleAbi, OracleRouterAbi } from "@xorr/sdk";

/**
 * Is this deployment actually working right now?
 *
 * Three things can be true or false independently, and a demo fails differently for
 * each: the chain can be unreachable, the keeper can have stopped publishing while the
 * chain carries on, and Kuru's book can go thin while both of the others are fine.
 * Collapsing them into one "ok" would hide exactly the distinction worth having, so
 * each is reported on its own with the evidence behind it.
 *
 * Every number here comes from a contract call. There is no cached status to go stale.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const ORACLE = process.env.NEXT_PUBLIC_ORACLE as Address | undefined;
const KURU_ORACLE = process.env.NEXT_PUBLIC_KURU_ORACLE as Address | undefined;

/** keccak256("BTC-USD") — the market the keeper publishes most often. */
const BTC_ID = "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e" as Hex;
/** keccak256("MON-USD") — priced from Kuru's book. */
const MON_ID = "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62" as Hex;

/** A push feed older than this has stopped, whatever it claims. */
const KEEPER_STALE_S = 30;

type Part = { status: "ok" | "degraded" | "down"; detail?: string; [k: string]: unknown };

export async function GET() {
  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC) });

  // ---- the chain
  let chainPart: Part = { status: "down", detail: "unreachable" };
  let block: bigint | null = null;
  try {
    block = await pub.getBlockNumber();
    chainPart = { status: "ok", block: block.toString(), chainId: CHAIN_ID };
  } catch (e) {
    chainPart = { status: "down", detail: (e as Error).message.slice(0, 120), chainId: CHAIN_ID };
  }

  // ---- the keeper, measured by how old its last print is rather than by asking it
  let keeper: Part = { status: "down", detail: "no oracle configured" };
  if (ORACLE && chainPart.status === "ok") {
    try {
      const [price, updatedAt] = (await pub.readContract({
        address: ORACLE,
        abi: OracleRouterAbi,
        functionName: "latest",
        args: [BTC_ID],
      })) as readonly [bigint, bigint];
      const ageS = Math.max(0, Math.floor(Date.now() / 1000) - Number(updatedAt));
      keeper = {
        status: ageS <= KEEPER_STALE_S ? "ok" : "degraded",
        detail:
          ageS <= KEEPER_STALE_S
            ? `last BTC print ${ageS}s ago`
            : `last BTC print ${ageS}s ago — over the ${KEEPER_STALE_S}s limit, the keeper has stopped`,
        lastPrice: (Number(price) / 1e8).toFixed(2),
        ageSeconds: ageS,
      };
    } catch (e) {
      keeper = { status: "down", detail: (e as Error).message.slice(0, 120) };
    }
  }

  // ---- Kuru's book, through XORR's own oracle rather than an API
  let book: Part = { status: "down", detail: "no Kuru oracle deployed" };
  if (KURU_ORACLE && chainPart.status === "ok") {
    try {
      const [bid, ask, mid, spreadBps] = (await pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "quoteTop",
        args: [MON_ID],
      })) as readonly [bigint, bigint, bigint, bigint];
      const ok = bid > 0n && ask > bid;
      book = {
        status: ok ? "ok" : "degraded",
        detail: ok
          ? `mid ${(Number(mid) / 1e8).toFixed(6)} at ${spreadBps} bps`
          : "the book is one-sided or crossed — the oracle is refusing to price it",
        bid: (Number(bid) / 1e8).toFixed(6),
        ask: (Number(ask) / 1e8).toFixed(6),
        spreadBps: Number(spreadBps),
      };
    } catch (e) {
      // A guard tripping is the oracle working, not the service failing.
      const msg = (e as Error).message;
      book = {
        status: "degraded",
        detail: /NoPrice|BadSpread|NoBook/.test(msg)
          ? "the oracle is refusing to price this book — a guard is holding"
          : msg.slice(0, 120),
      };
    }
  }

  const parts = [chainPart, keeper, book];
  const status = parts.some((p) => p.status === "down")
    ? "down"
    : parts.some((p) => p.status === "degraded")
      ? "degraded"
      : "ok";

  return NextResponse.json(
    { status, chain: chainPart, keeper, book, checkedAt: new Date().toISOString() },
    {
      status: status === "down" ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
