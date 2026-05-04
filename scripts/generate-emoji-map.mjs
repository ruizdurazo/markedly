import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nameToEmoji } from "gemoji";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "generated");
const outFile = join(outDir, "name-to-emoji.json");

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(nameToEmoji)}\n`);
console.log(`Wrote ${outFile}`);
