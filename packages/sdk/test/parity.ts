/**
 * Differential test: every quote the Solidity pricing library produced must be
 * reproduced exactly by the TypeScript mirror the desk renders from.
 *
 * Regenerate the fixture with:  cd packages/contracts && forge test --match-contract ParityDump
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NORMAL_TABLE, quote, sigmaBps1e4 } from "../src/pricing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const csv = join(here, "../../contracts/parity/quotes.csv");

const lines = readFileSync(csv, "utf8").trim().split("\n");
const header = lines.shift()!;
if (!header.startsWith("spot,low,high")) throw new Error(`unexpected fixture header: ${header}`);

let checked = 0;
const mismatches: string[] = [];

for (const line of lines) {
  const [spot, low, high, blocks, volBps, refBlocks, edge, expMult, expProb] = line
    .split(",")
    .map((s) => BigInt(s.trim()));

  const got = quote(NORMAL_TABLE, spot, low, high, sigmaBps1e4(volBps, blocks, refBlocks), edge);
  if (got.multiplierBps !== expMult || got.prob1e6 !== expProb) {
    mismatches.push(
      `spot=${spot} low=${low} high=${high} blocks=${blocks} vol=${volBps}\n` +
        `  solidity: mult=${expMult} prob=${expProb}\n` +
        `  typescript: mult=${got.multiplierBps} prob=${got.prob1e6}`,
    );
  }
  checked++;
}

if (mismatches.length > 0) {
  console.error(`PARITY FAILED: ${mismatches.length}/${checked} rows differ\n`);
  console.error(mismatches.slice(0, 10).join("\n\n"));
  process.exit(1);
}

console.log(`parity ok: ${checked} quotes identical between Solidity and TypeScript`);
