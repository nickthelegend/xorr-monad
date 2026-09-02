/**
 * A real room round: two funded accounts share a code, each paints a different band on
 * the same market and cutoff, and the pot is distributed on-chain.
 *
 * Rooms are player-vs-player — the vault takes a fee and carries no risk — so the two
 * properties worth proving are that the pot closes out to exactly zero and that the
 * house bankroll is untouched.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8545";
const root = fileURLToPath(new URL("../../packages/contracts/", import.meta.url));
const d = JSON.parse(readFileSync(`${root}deployments/143.json`, "utf8"));
const abi = (n) => JSON.parse(readFileSync(`${root}out/${n}.sol/${n}.json`, "utf8")).abi;
const RoomAbi = abi("RoomMarket");
const RangeAbi = abi("RangeMarket");
const VaultAbi = abi("XorrVault");
const ERC20 = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

const chain = defineChain({ id: 143, name: "m", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const wa = createWalletClient({ account: alice, chain, transport: http(RPC) });
const wb = createWalletClient({ account: bob, chain, transport: http(RPC) });

const BTC = "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e";
const STAKE = 3_000_000n;
const usd = (v) => `$${(Number(v) / 1e6).toFixed(4)}`;
const px = (v) => `$${(Number(v) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

// Bob needs AUSD and gas; fund him from a real holder on the fork.
const WHALE = "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5";
await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_impersonateAccount", params: [WHALE] }) });
await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "anvil_setBalance", params: [WHALE, "0x56BC75E2D63100000"] }) });
await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_sendTransaction", params: [{ from: WHALE, to: d.ausd, data: "0xa9059cbb" + bob.address.slice(2).toLowerCase().padStart(64, "0") + (50_000_000n).toString(16).padStart(64, "0") }] }) });
await new Promise((r) => setTimeout(r, 1500));
await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "anvil_stopImpersonatingAccount", params: [WHALE] }) });

for (const [w, who] of [[wa, alice], [wb, bob]]) {
  await w.writeContract({ address: d.ausd, abi: ERC20, functionName: "approve", args: [d.roomMarket, 2n ** 255n] });
}

const [spot, , maxH] = await pub.readContract({ address: d.rangeMarket, abi: RangeAbi, functionName: "bandLimits", args: [BTC, 2] });
const half = (spot * maxH) / 100_000_000n;

// Two different bands on the same cutoff: Alice around spot, Bob offset above it.
const aLow = spot - half, aHigh = spot + half;
const bLow = spot + half / 2n, bHigh = spot + half * 2n;

const code = toHex("XORR0001", { size: 8 });
const vaultBefore = await pub.readContract({ address: d.vault, abi: VaultAbi, functionName: "totalAssets" });
const reservedBefore = await pub.readContract({ address: d.vault, abi: VaultAbi, functionName: "reserved" });
const aBefore = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [alice.address] });
const bBefore = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [bob.address] });

let h = await wa.writeContract({ address: d.roomMarket, abi: RoomAbi, functionName: "createRoom", args: [code, BTC, STAKE, 100, 4, aLow, aHigh] });
await pub.waitForTransactionReceipt({ hash: h });
const id = await pub.readContract({ address: d.roomMarket, abi: RoomAbi, functionName: "roomByCode", args: [code] });
console.log(`room #${id} created with code XORR0001, stake ${usd(STAKE)} each`);
console.log(`  alice band ${px(aLow)} .. ${px(aHigh)}`);

h = await wb.writeContract({ address: d.roomMarket, abi: RoomAbi, functionName: "joinByCode", args: [code, bLow, bHigh] });
await pub.waitForTransactionReceipt({ hash: h });
console.log(`  bob   band ${px(bLow)} .. ${px(bHigh)}`);

const room = await pub.readContract({ address: d.roomMarket, abi: RoomAbi, functionName: "getRoom", args: [id] });
const pot = await pub.readContract({ address: d.roomMarket, abi: RoomAbi, functionName: "potOf", args: [id] });
console.log(`  pot ${usd(pot)}, cutoff block ${room.expiryBlock}`);

while (Number(await pub.getBlockNumber()) < room.expiryBlock) await new Promise((r) => setTimeout(r, 300));
h = await wa.writeContract({ address: d.roomMarket, abi: RoomAbi, functionName: "settleRoom", args: [id] });
await pub.waitForTransactionReceipt({ hash: h });

const after = await pub.readContract({ address: d.roomMarket, abi: RoomAbi, functionName: "getRoom", args: [id] });
const aAfter = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [alice.address] });
const bAfter = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [bob.address] });
const vaultAfter = await pub.readContract({ address: d.vault, abi: VaultAbi, functionName: "totalAssets" });
const reservedAfter = await pub.readContract({ address: d.vault, abi: VaultAbi, functionName: "reserved" });
const roomBal = await pub.readContract({ address: d.ausd, abi: ERC20, functionName: "balanceOf", args: [d.roomMarket] });

console.log(`\nsettled at ${px(after.settledPrice)}`);
console.log(`  alice ${aAfter - aBefore >= 0n ? "+" : ""}${usd(aAfter - aBefore)}`);
console.log(`  bob   ${bAfter - bBefore >= 0n ? "+" : ""}${usd(bAfter - bBefore)}`);
console.log(`  vault fee +${usd(vaultAfter - vaultBefore)}`);
console.log(`  room contract balance ${usd(roomBal)}`);

const conserved = (aAfter - aBefore) + (bAfter - bBefore) + (vaultAfter - vaultBefore) === 0n;
const noHouseRisk = reservedAfter === reservedBefore;
const emptied = roomBal === 0n;

console.log(`\npot conserved: ${conserved}`);
console.log(`house bankroll untouched: ${noHouseRisk} (reserved ${reservedBefore} -> ${reservedAfter})`);
console.log(`room emptied: ${emptied}`);
console.log(conserved && noHouseRisk && emptied ? "H-5 PASS" : "H-5 FAIL");
process.exit(conserved && noHouseRisk && emptied ? 0 : 1);
