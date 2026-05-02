import { execSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function waitForPort(port, host = "127.0.0.1", timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 150);
        }
      });
    };
    attempt();
  });
}

execSync("node scripts/build-main.mjs", { cwd: root, stdio: "inherit" });

const vite = spawn("npx", ["vite", "--host", "127.0.0.1"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const mainWatch = spawn("node", ["scripts/build-main.mjs", "--watch"], {
  cwd: root,
  stdio: "inherit",
});

await waitForPort(5173);

const electron = spawn("npx", ["electron", "."], {
  cwd: root,
  env: {
    ...process.env,
    VITE_DEV_SERVER: "1",
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill("SIGTERM");
  mainWatch.kill("SIGTERM");
  electron.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
electron.on("close", (code) => shutdown(code ?? 0));
