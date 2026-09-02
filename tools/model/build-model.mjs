/**
 * Serialise the XORR console to a .glb.
 *
 * The shape itself lives in packages/sdk/src/console-geometry.ts, which the web app
 * builds from directly — the app does not fetch this file. This exists so the model is
 * available as a normal asset: to open in Blender, drop into a deck, or hand to anyone
 * who wants it.
 *
 * Run: pnpm model
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeGlb } from "./glb.mjs";

const { buildConsole, CONSOLE_MATERIALS } = await import(
  fileURLToPath(new URL("../../packages/sdk/src/console-geometry.ts", import.meta.url))
);

const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
  1,
];

const materials = CONSOLE_MATERIALS.map((m) => ({
  name: m.name,
  pbrMetallicRoughness: {
    baseColorFactor: hex(m.color),
    metallicFactor: m.metallic,
    roughnessFactor: m.roughness,
  },
  ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
}));

const meshes = buildConsole();
const glb = writeGlb(meshes, materials, { name: "xorr-console" });

const out = fileURLToPath(new URL("../../apps/web/public/xorr-console.glb", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);

const tris = meshes.reduce((a, m) => a + m.indices.length / 3, 0);
console.log(`xorr-console.glb  ${(glb.length / 1024).toFixed(1)} KB  ${tris} tris  ${meshes.length} meshes`);
console.log(`  ${out}`);
