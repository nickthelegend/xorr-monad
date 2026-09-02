/**
 * Monad network facts, verified against docs.monad.xyz at build time.
 * Mainnet block time is ~300ms with ~600ms finality (MIP-12, live since 23 Jul 2026),
 * which is the entire reason a XORR round can be three seconds long.
 */
export interface ChainDef {
  id: number;
  name: string;
  rpc: string[];
  ws?: string;
  explorer: string;
  explorerTx: (h: string) => string;
  native: { symbol: string; decimals: number };
  blockMs: number;
}

export const monad: ChainDef = {
  id: 143,
  name: "Monad",
  rpc: [
    "https://rpc.monad.xyz",
    "https://rpc1.monad.xyz",
    "https://rpc2.monad.xyz",
    "https://rpc3.monad.xyz",
  ],
  ws: "wss://rpc.monad.xyz",
  explorer: "https://monadvision.com",
  explorerTx: (h) => `https://monadvision.com/tx/${h}`,
  native: { symbol: "MON", decimals: 18 },
  blockMs: 300,
};

export const monadTestnet: ChainDef = {
  id: 10143,
  name: "Monad Testnet",
  rpc: ["https://rpc.testnet.monad.xyz"],
  explorer: "https://testnet.monadscan.com",
  explorerTx: (h) => `https://testnet.monadscan.com/tx/${h}`,
  native: { symbol: "MON", decimals: 18 },
  blockMs: 300,
};

/** Local anvil, run with --block-time 0.3 so it ticks like Monad does. */
export const localChain: ChainDef = {
  id: 31337,
  name: "Local",
  rpc: ["http://127.0.0.1:8545"],
  explorer: "",
  explorerTx: (h) => h,
  native: { symbol: "ETH", decimals: 18 },
  blockMs: 300,
};

export const CHAINS = [monad, monadTestnet, localChain];
export const chainById = (id: number) => CHAINS.find((c) => c.id === id);

/**
 * Kuru is Monad's onchain CLOB. XORR reads mid and top-of-book width from it for the
 * MON mark and the desk's spread meter; it never routes user orders through it.
 * Addresses from docs.kuru.io/contracts/Contract-addresses.
 */
export const KURU = {
  ws: "wss://ws.kuru.io/",
  api: "https://api.kuru.io/",
  mainnet: {
    flowEntrypoint: "0xb3e6778480b2E488385E8205eA05E20060B813cb",
    flowRouter: "0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2",
    marginAccount: "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5",
    router: "0xd651346d7c789536ebf06dc72aE3C8502cd695CC",
    marketMonAusd: "0x131a2e70a5b31a517a74b8c567149bc294470da9",
    marketMonUsdc: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  },
} as const;

/** Agora AUSD on Monad mainnet, 6 decimals. Verify against monad-crypto/token-list. */
export const AUSD_MAINNET = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
