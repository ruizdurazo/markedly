import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ file: string; px: number }[]} */
const ICONSET_SLOTS = [
  { file: "icon_16x16.png", px: 16 },
  { file: "icon_16x16@2x.png", px: 32 },
  { file: "icon_32x32.png", px: 32 },
  { file: "icon_32x32@2x.png", px: 64 },
  { file: "icon_128x128.png", px: 128 },
  { file: "icon_128x128@2x.png", px: 256 },
  { file: "icon_256x256.png", px: 256 },
  { file: "icon_256x256@2x.png", px: 512 },
  { file: "icon_512x512.png", px: 512 },
  { file: "icon_512x512@2x.png", px: 1024 },
];

function readPngPixelSize(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length < 24) throw new Error(`${filePath}: file too small`);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error(`${filePath}: not a PNG`);
  }
  const len = buf.readUInt32BE(8);
  const type = buf.subarray(12, 16).toString("ascii");
  if (type !== "IHDR" || len !== 13) {
    throw new Error(`${filePath}: expected IHDR chunk`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== height) {
    throw new Error(`${filePath}: expected square icon, got ${width}×${height}`);
  }
  return width;
}

function parseArgs(argv) {
  let inputDir = join(root, "resources", "icon-source");
  let iconsetDir = join(root, "build", "AppIcon.iconset");
  let icnsOut = join(root, "resources", "icon.icns");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) {
      const raw = argv[++i];
      inputDir = resolve(isAbsolute(raw) ? raw : join(root, raw));
    } else if (a === "--iconset" && argv[i + 1]) {
      const raw = argv[++i];
      iconsetDir = resolve(isAbsolute(raw) ? raw : join(root, raw));
    } else if (a === "--icns" && argv[i + 1]) {
      const raw = argv[++i];
      icnsOut = resolve(isAbsolute(raw) ? raw : join(root, raw));
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/build-mac-icon.mjs [options]

  --input <dir>    Folder of arbitrary-named square PNGs (default: resources/icon-source)
  --iconset <path> Output .iconset directory (default: build/AppIcon.iconset)
  --icns <path>    Output .icns file (default: resources/icon.icns)

Detects each PNG's pixel size, maps to Apple iconset filenames (reusing the same
file when two slots need identical dimensions), runs iconutil on macOS.`);
      process.exit(0);
    }
  }
  return { inputDir, iconsetDir, icnsOut };
}

function collectSourcesBySize(inputDir) {
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory missing: ${inputDir}`);
  }
  /** @type {Map<number, string[]>} */
  const bySize = new Map();
  const names = readdirSync(inputDir).filter((n) => /\.png$/i.test(n));
  if (names.length === 0) {
    throw new Error(`No .png files in ${inputDir}`);
  }
  for (const name of names) {
    const abs = join(inputDir, name);
    const px = readPngPixelSize(abs);
    const list = bySize.get(px) ?? [];
    list.push(abs);
    bySize.set(px, list);
  }
  for (const [px, paths] of bySize) {
    paths.sort((a, b) => basename(a).localeCompare(basename(b)));
    bySize.set(px, paths);
  }
  return bySize;
}

function pickSourceForSlot(px, bySize) {
  const exact = bySize.get(px)?.[0];
  if (exact) return { path: exact, px };

  const sizes = [...bySize.keys()].sort((a, b) => a - b);
  const larger = sizes.find((s) => s >= px);
  if (!larger) {
    const have = sizes.join(", ");
    throw new Error(
      `No PNG for ${px}×${px} and no image large enough to downscale. Have sizes: ${have || "none"}`,
    );
  }
  return { path: bySize.get(larger)[0], px: larger };
}

function ensureDownscaled(srcPath, srcPx, targetPx, outPath) {
  if (srcPx === targetPx) {
    copyFileSync(srcPath, outPath);
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error(
      `Need a ${targetPx}×${targetPx} PNG (have ${srcPx}×${srcPx} from ${srcPath}). On macOS this script can downscale with sips; otherwise add the missing size.`,
    );
  }
  mkdirSync(join(outPath, ".."), { recursive: true });
  execFileSync("sips", [
    "-z",
    String(targetPx),
    String(targetPx),
    srcPath,
    "--out",
    outPath,
  ], { stdio: "inherit" });
}

function main() {
  const { inputDir, iconsetDir, icnsOut } = parseArgs(process.argv);
  const bySize = collectSourcesBySize(inputDir);

  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });

  const logLines = [];
  for (const { file, px } of ICONSET_SLOTS) {
    const { path: src, px: srcPx } = pickSourceForSlot(px, bySize);
    const dest = join(iconsetDir, file);
    ensureDownscaled(src, srcPx, px, dest);
    const note =
      srcPx === px
        ? basename(src)
        : `${basename(src)} (${srcPx}px → ${px}px via sips)`;
    logLines.push(`  ${file}  ←  ${note}`);
  }

  console.log("Iconset mapping:\n" + logLines.join("\n"));

  if (process.platform !== "darwin") {
    console.warn(
      "\nSkipping iconutil (macOS only). Iconset written to:\n  " + iconsetDir,
    );
    return;
  }

  mkdirSync(join(icnsOut, ".."), { recursive: true });
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsOut], {
    stdio: "inherit",
  });
  console.log("\nWrote " + icnsOut);
}

main();
