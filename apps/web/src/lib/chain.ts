"use client";

import { createPublicClient, createWalletClient, custom, defineChain, http, type Address } from "viem";

/**
 * Monad. Chain 143, ~300ms blocks, ~600ms finality (MIP-12, live since 23 Jul 2026).
 * Facts verified against docs.monad.xyz/developer-essentials/network-information.
 */
export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"], webSocket: ["wss://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
  // Verified present on Monad mainnet at the canonical address.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

/**
 * Local anvil, run with `pnpm chain` so it ticks at Monad's cadence.
 * Deliberately no multicall3: a bare anvil does not deploy one, and claiming otherwise
 * makes every batched read fail with a confusing "chain does not support" error.
 */
export const local = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const CHAINS = [monad, monadTestnet, local];

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
export const activeChain = CHAINS.find((c) => c.id === CHAIN_ID) ?? monad;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? activeChain.rpcUrls.default.http[0];

const addr = (v: string | undefined): Address | null =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;

export const ADDRESSES = {
  ausd: addr(process.env.NEXT_PUBLIC_AUSD),
  oracle: addr(process.env.NEXT_PUBLIC_ORACLE),
  vault: addr(process.env.NEXT_PUBLIC_VAULT),
  rangeMarket: addr(process.env.NEXT_PUBLIC_RANGE_MARKET),
  roomMarket: addr(process.env.NEXT_PUBLIC_ROOM_MARKET),
};

/** True only when there is a real deployment to talk to. */
export const LIVE_CONFIGURED = Boolean(ADDRESSES.rangeMarket && ADDRESSES.ausd);

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(RPC_URL),
  // Batch reads into one multicall where the chain has one. On a 300ms chain the
  // round trips matter more than the call count.
  batch: activeChain.contracts?.multicall3 ? { multicall: true } : undefined,
});

export function explorerTx(hash: string): string | null {
  const base = activeChain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, cb: (...a: unknown[]) => void) => void;
}

export function injected(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

/**
 * Connect an injected wallet and make sure it is pointed at the chain XORR is
 * deployed on, adding the network if the wallet has never seen it.
 */
export async function connectWallet(): Promise<Address> {
  const eth = injected();
  if (!eth) throw new Error("No wallet found. Install MetaMask or use the demo desk.");

  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const hexId = `0x${activeChain.id.toString(16)}`;

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    // 4902 = wallet has never heard of this chain.
    if ((e as { code?: number }).code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: activeChain.name,
            nativeCurrency: activeChain.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: activeChain.blockExplorers
              ? [activeChain.blockExplorers.default.url]
              : [],
          },
        ],
      });
    } else {
      throw e;
    }
  }

  return accounts[0];
}

export function walletClientFor(account: Address) {
  const eth = injected();
  if (!eth) throw new Error("No wallet");
  return createWalletClient({ account, chain: activeChain, transport: custom(eth) });
}
