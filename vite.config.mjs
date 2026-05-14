import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @returns {import('vite').Plugin} */
function devCspPlugin() {
  const devCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173 http://localhost:5173",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' file: data: blob: http: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173 http://localhost:5173 ws://localhost:5173",
    "worker-src 'self' blob:",
  ].join("; ");

  return {
    name: "markedly-dev-csp",
    /** @param {string} html @param {import('vite').IndexHtmlTransformContext} ctx */
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/>/,
        `<meta http-equiv="Content-Security-Policy" content="${devCsp}" />`,
      );
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react(), svgr(), devCspPlugin()],
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/renderer/index.html"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
});
