/**
 * Fire real tickets at the widest legal band until one wins, then check the winner was
 * paid exactly the payout the ticket promised.
 *
 * Everything here is a real signed transaction against the deployed market.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8545";
const root = fileURLToPath(new URL("../../packages/contracts/", import.meta.url));
const d = JSON.parse(readFileSync(`${root}deployments/143.json`, "utf8"));
const abi = (n) => JSON.parse(readFileSync(`${root}out/${n}.sol/${n}.json`, "utf8")).abi;
const RangeAbi = abi("RangeMarket");
const ERC20 = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

const chain = defineChain({ id: 143, name: "m", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const BTC = "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e";
const TIER = 0; // 3s round, fastest settlement
const STAKE = 2_000_000n;

await wallet.writeContract({ address: d.ausd, abi: ERC20, functionName: "approve", args: [d.rangeMarket, 2n ** 255n] });

const usd = (v) => `$${(Number(v) / 1e6).toFixed(4)}`;
const px = (v) => `$${(Number(v) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

for (let attempt = 1; attempt <= 14; attempt++) {
  const [, , maxH] = await pub.readContract({ address: d.rangeMarket, abi: RangeAbi, functionName: "bandLimits", args: [BTC, TIER] });

  const before = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  const hash = await wallet.writeContract({
    address: d.rangeMarket, abi: RangeAbi, functionName: "fireBand",
    args: [BTC, Number(maxH), Number(maxH), STAKE, TIER],
  });
  const rec = await pub.waitForTransactionReceipt({ hash });
  if (rec.status !== "success") { console.log(`attempt ${attempt}: fire reverted`); continue; }

  const id = await pub.readContract({ address: d.rangeMarket, abi: RangeAbi, functionName: "nextTicketId" }) - 1n;
  let t = await pub.readContract({ address: d.rangeMarket, abi: RangeAbi, functionName: "getTicket", args: [id] });

  while (Number(await pub.getBlockNumber()) < t.expiryBlock) await new Promise((r) => setTimeout(r, 300));

  try {
    const sh = await wallet.writeContract({ address: d.rangeMarket, abi: RangeAbi, functionName: "settle", args: [id] });
    await pub.waitForTransactionReceipt({ hash: sh });
  } catch { /* the desk or keeper may have settled it first — that is the point of a public poke */ }

  t = await pub.readContract({ address: d.rangeMarket, abi: RangeAbi, functionName: "getTicket", args: [id] });
  const after = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  const delta = after - before;
  const status = ["open", "WON", "lost", "void"][t.status];

  console.log(
    `#${id} ${status.padEnd(4)} band ${px(t.low)}..${px(t.high)} settled ${px(t.settledPrice)} ` +
      `stake ${usd(t.stake)} payout ${usd(t.payout)} balance ${delta >= 0n ? "+" : ""}${usd(delta)}`,
  );

  if (t.status === 1) {
    const expected = t.payout - t.stake;
    const ok = delta === expected;
    console.log(`\nwinner credited ${usd(delta)}; ticket promised ${usd(t.payout)} on a ${usd(t.stake)} stake`);
    console.log(ok ? "G-9 PASS: paid exactly the payout" : `G-9 FAIL: expected net ${usd(expected)}`);
    process.exit(ok ? 0 : 1);
  }
}
console.log("no win in 14 attempts");
process.exit(1);
