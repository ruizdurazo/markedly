import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

mkdirSync(join(dist, "main"), { recursive: true });
mkdirSync(join(dist, "preload"), { recursive: true });

const commonNode = {
  bundle: true,
  platform: "node",
  target: "node20",
  sourcemap: watch,
  external: ["electron"],
  logLevel: "info",
};

async function run() {
  const mainCtx = await esbuild.context({
    ...commonNode,
    entryPoints: [join(root, "src/main/index.ts")],
    outfile: join(dist, "main", "index.js"),
    format: "cjs",
  });
  const preloadCtx = await esbuild.context({
    ...commonNode,
    entryPoints: [join(root, "src/preload/index.ts")],
    outfile: join(dist, "preload", "index.js"),
    format: "cjs",
  });

  if (watch) {
    await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  } else {
    await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild()]);
    await Promise.all([mainCtx.dispose(), preloadCtx.dispose()]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
