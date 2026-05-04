import * as esbuild from "esbuild";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "quicklook");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "src", "quicklook", "preview.ts")],
  outfile: join(dist, "preview.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "safari14",
  sourcemap: false,
  logLevel: "info",
});

const styles = sass.compile(join(root, "src", "quicklook", "styles.scss"), {
  style: "compressed",
}).css;
const highlightLight = readFileSync(
  require.resolve("highlight.js/styles/github.css"),
  "utf8",
);
const highlightDark = readFileSync(
  require.resolve("highlight.js/styles/github-dark.css"),
  "utf8",
);

writeFileSync(
  join(dist, "preview.css"),
  `${styles}\n${highlightLight}\n@media (prefers-color-scheme: dark){${highlightDark}}\n`,
);

const html = readFileSync(join(root, "src", "quicklook", "preview.html"), "utf8");
writeFileSync(join(dist, "preview.html"), html);

for (const file of ["preview.html", "preview.css", "preview.js"]) {
  const outFile = join(dist, file);
  if (!existsSync(outFile)) {
    throw new Error(`Quick Look build did not produce ${outFile}`);
  }
}
