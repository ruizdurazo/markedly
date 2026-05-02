# Markedly: macOS Markdown viewer

A minimal Markdown viewer built with [Electron](https://www.electronjs.org/). Editing is out of scope—open a file, read it, render it safely.

## Features

- **Open** via File → Open… (`⌘O`), drag-and-drop, or launch with a path: `npx electron . ./fixtures/sample.md`
- **GFM** via [marked](https://marked.js.org/): headings, lists, tables, task lists, strikethrough, autolinks, fenced code, blockquotes
- **Syntax highlighting** ([highlight.js](https://highlightjs.org/)) and **Mermaid** diagrams (fenced `mermaid`)
- **Sanitized HTML** from Markdown via [DOMPurify](https://github.com/cure53/DOMPurify)
- **Relative images** use a `<base href>` tied to the file’s directory (`file:` URLs)
- **Live reload** when the file changes on disk (debounced `fs.watch`)
- **macOS**: `hiddenInset` title bar, **Open Recent**, **`open-file`** from Finder, single-instance lock

## Develop

```bash
npm install
npm run build   # vite build (renderer) + esbuild (main/preload)
npm start
```

**Hot reload (SCSS + renderer):** Vite dev server on `127.0.0.1:5173`; Electron loads that URL when `VITE_DEV_SERVER=1` (set by `npm run dev`). Main/preload still use esbuild watch and require an app restart when those change.

```bash
npm run dev
```

Optional utilities:

```bash
npm run build:main       # main + preload only (dist/main, dist/preload)
npm run build:renderer  # vite build only
```

Typecheck:

```bash
npm run typecheck
```

## Pack (macOS)

Requires Apple code signing/notarization for distribution outside your machine.

```bash
npm run pack
```

Output under `release/`.

## Security model

- `contextIsolation`, no Node in the renderer, **sandboxed** `BrowserWindow`
- Preload exposes a small IPC surface: open dialog, read file, file-changed / theme events
- External links open in the system browser; navigation in the window is not used for MD rendering

## Project layout

- `src/main` — menus, dialogs, file I/O, watcher, single-instance
- `src/preload` — `contextBridge` API
- `src/renderer` — Vite app: `index.html`, `main.ts`, SCSS, Markdown UI (dev: HMR; prod: `dist/renderer/`)
- `vite.config.mjs` — `base: './'` for `file://` packaging; dev-only CSP relax for HMR
- `fixtures/sample.md` — smoke-test document
