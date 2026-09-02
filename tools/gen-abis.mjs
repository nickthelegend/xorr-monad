/**
 * Extract the ABIs the desk actually calls from the Foundry build output into a typed
 * TS module. Generated rather than hand-written so a contract change that breaks the
 * frontend breaks the build, instead of at runtime in front of a judge.
 *
 * Run: node tools/gen-abis.mjs   (after `forge build`)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../packages/contracts/out/", import.meta.url));
const CONTRACTS = [
  ["XorrVault", "XorrVault.sol"],
  ["RangeMarket", "RangeMarket.sol"],
  ["RoomMarket", "RoomMarket.sol"],
  ["TestAUSD", "TestAUSD.sol"],
  ["KeeperOracle", "KeeperOracle.sol"],
];

const out = [
  "/** GENERATED FILE - do not edit by hand. Run `node tools/gen-abis.mjs`. */",
  "",
];

for (const [name, file] of CONTRACTS) {
  const artifact = JSON.parse(readFileSync(`${root}${file}/${name}.json`, "utf8"));
  out.push(`export const ${name}Abi = ${JSON.stringify(artifact.abi)} as const;`);
  out.push("");
}

const dir = fileURLToPath(new URL("../packages/sdk/src/generated/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}abis.ts`, out.join("\n"));
console.log(`wrote ${dir}abis.ts (${CONTRACTS.length} ABIs)`);
