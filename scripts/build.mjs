import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

execSync("vite build", { cwd: root, stdio: "inherit" });
execSync("node scripts/build-quicklook.mjs", { cwd: root, stdio: "inherit" });
execSync("node scripts/build-main.mjs", { cwd: root, stdio: "inherit" });
