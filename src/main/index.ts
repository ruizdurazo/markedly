import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ResolvedMdLink } from "../shared/types.js";

if (!app.isPackaged) {
  app.commandLine.appendSwitch("disable-http-cache");
}

type WatchEntry = {
  handle: ReturnType<typeof watch>;
  debounce: ReturnType<typeof setTimeout> | null;
};

const fileWatchers = new Map<string, WatchEntry>();
let pendingOpenPath: string | null = null;
/** First BrowserWindow created in this session; launch argv is delivered only to this window once. */
let firstCreatedWindowId: number | null = null;
let argvLaunchHandled = false;

function extractMdFromArgv(argv: string[]): string | null {
  const sliceStart = process.defaultApp ? 2 : 1;
  const args = argv.slice(sliceStart);
  for (const a of args) {
    if (a.startsWith("-")) continue;
    const lower = a.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdown") || lower.endsWith(".mkd")) {
      return resolve(a);
    }
  }
  return null;
}

async function validateMdPath(filePath: string): Promise<string | null> {
  try {
    const p = resolve(filePath);
    const s = await stat(p);
    if (!s.isFile()) return null;
    return p;
  } catch {
    return null;
  }
}

function isMarkdownExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".mdown") ||
    lower.endsWith(".mkd")
  );
}

async function resolveMarkdownHref(baseFilePath: string, href: string): Promise<ResolvedMdLink | null> {
  const baseResolved = resolve(baseFilePath);
  const hRaw = href.trim();
  if (!hRaw || hRaw.toLowerCase().startsWith("javascript:")) return null;

  if (/^[a-z][a-z0-9+.-]*:/i.test(hRaw)) {
    const lower = hRaw.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:")) {
      return { kind: "external", url: hRaw };
    }
    if (lower.startsWith("file:")) {
      try {
        const u = new URL(hRaw);
        const fragFromUrl = u.hash ? u.hash.slice(1) : undefined;
        u.hash = "";
        const fsPath = fileURLToPath(u.href);
        if (!isMarkdownExtension(fsPath)) return null;
        const ok = await validateMdPath(fsPath);
        if (!ok) return null;
        return { kind: "markdown", path: ok, fragment: fragFromUrl };
      } catch {
        return null;
      }
    }
    return { kind: "external", url: hRaw };
  }

  const hashIdx = hRaw.indexOf("#");
  const pathPart = hashIdx >= 0 ? hRaw.slice(0, hashIdx) : hRaw;
  const fragment = hashIdx >= 0 ? hRaw.slice(hashIdx + 1) : undefined;

  if (!pathPart) {
    if (fragment !== undefined && fragment.length > 0) {
      return { kind: "fragment", fragment };
    }
    return null;
  }

  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }

  const candidate = resolve(dirname(baseResolved), decoded);
  if (!isMarkdownExtension(candidate)) return null;
  const ok = await validateMdPath(candidate);
  if (!ok) return null;
  return { kind: "markdown", path: ok, fragment: fragment || undefined };
}

function dirToFileUrl(dir: string): string {
  const url = pathToFileURL(join(dir, ".")).href;
  return url.endsWith("/") ? url : `${url}/`;
}

function notifyFileChanged(filePath: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("md:file-changed", filePath);
  }
}

function ensureWatching(filePath: string) {
  if (fileWatchers.has(filePath)) return;
  try {
    const entry: WatchEntry = {
      handle: watch(filePath, { persistent: false }, () => {
        if (entry.debounce != null) clearTimeout(entry.debounce);
        entry.debounce = setTimeout(() => {
          entry.debounce = null;
          notifyFileChanged(filePath);
        }, 150);
      }),
      debounce: null,
    };
    fileWatchers.set(filePath, entry);
  } catch {
    // optional
  }
}

function getDialogParentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1) ?? null;
}

/** Option (a): route opens to the focused window; fallback to last created window. */
function getTargetWindowForOpen(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows();
  return all.length ? all[all.length - 1]! : null;
}

function sendOpenPathToTarget(path: string) {
  const win = getTargetWindowForOpen();
  if (win && !win.isDestroyed()) {
    win.webContents.send("md:open-path", path);
    void win.focus();
  }
}

function broadcastThemeChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("md:theme-changed");
  }
}

function createWindow(): BrowserWindow {
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 960,
    height: 740,
    minWidth: 480,
    minHeight: 400,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (process.platform === "darwin") {
    options.titleBarStyle = "hiddenInset";
    options.trafficLightPosition = { x: 14, y: 14 };
  }

  const win = new BrowserWindow(options);

  if (firstCreatedWindowId == null) {
    firstCreatedWindowId = win.id;
  }
  win.on("closed", () => {
    if (win.id === firstCreatedWindowId) {
      firstCreatedWindowId = null;
    }
  });

  const devEnabled = process.env.VITE_DEV_SERVER === "1" && !app.isPackaged;
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  if (devEnabled) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const wc = win.webContents;
    const currentUrl = wc.getURL();
    if (url.toLowerCase().startsWith("javascript:")) {
      event.preventDefault();
      return;
    }
    try {
      const next = new URL(url);
      if (next.protocol === "file:") {
        next.hash = "";
        let fsPath = "";
        try {
          fsPath = fileURLToPath(next);
        } catch {
          fsPath = "";
        }
        if (fsPath && isMarkdownExtension(fsPath)) {
          event.preventDefault();
          void validateMdPath(fsPath).then((ok) => {
            if (ok && !win.isDestroyed()) {
              win.webContents.send("md:open-path-new-tab", ok);
            }
          });
          return;
        }
      }
      const cur = new URL(currentUrl);
      if (
        cur.origin === next.origin &&
        cur.pathname === next.pathname &&
        cur.search === next.search
      ) {
        return;
      }
    } catch {
      /* open below */
    }
    event.preventDefault();
    void shell.openExternal(url);
  });

  win.webContents.on("did-finish-load", () => {
    if (pendingOpenPath) {
      win.webContents.send("md:open-path", pendingOpenPath);
      pendingOpenPath = null;
      argvLaunchHandled = true;
      return;
    }
    if (!argvLaunchHandled && win.id === firstCreatedWindowId) {
      argvLaunchHandled = true;
      const fromArgv = extractMdFromArgv(process.argv);
      if (fromArgv) {
        void validateMdPath(fromArgv).then((p) => {
          if (p && !win.isDestroyed()) win.webContents.send("md:open-path", p);
        });
      }
    }
  });

  return win;
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            void createWindow();
          },
        },
        {
          label: "New tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            const win = getTargetWindowForOpen();
            win?.webContents.send("md:new-tab");
          },
        },
        {
          label: "Close tab",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            const win = getTargetWindowForOpen();
            win?.webContents.send("md:close-tab");
          },
        },
        { type: "separator" },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const win = getDialogParentWindow();
            if (!win) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] }],
            });
            if (!canceled && filePaths[0] && !win.isDestroyed()) {
              win.webContents.send("md:open-path", filePaths[0]);
            }
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        {
          label: "Close window",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => {
            BrowserWindow.getFocusedWindow()?.close();
          },
        },
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Markdown reference",
          click: () => {
            void shell.openExternal("https://commonmark.org/help/");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (BrowserWindow.getAllWindows().length > 0) {
    sendOpenPathToTarget(filePath);
  } else {
    pendingOpenPath = filePath;
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const p = extractMdFromArgv(commandLine);
    if (p) {
      void validateMdPath(p).then((ok) => {
        if (ok) sendOpenPathToTarget(ok);
      });
    } else {
      const win = getTargetWindowForOpen();
      void win?.focus();
    }
  });

  void app.whenReady().then(() => {
    buildMenu();
    void createWindow();

    nativeTheme.on("updated", () => {
      broadcastThemeChanged();
    });

    ipcMain.handle("md:new-window", () => {
      void createWindow();
    });

    ipcMain.handle("md:open-dialog", async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? getDialogParentWindow();
      if (!win) return null;
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] }],
      });
      if (canceled || !filePaths[0]) return null;
      return filePaths[0];
    });

    ipcMain.handle("md:normalize-path", async (_e, rawPath: unknown) => {
      if (typeof rawPath !== "string") return null;
      return validateMdPath(rawPath);
    });

    ipcMain.handle("md:read", async (_e, rawPath: unknown) => {
      if (typeof rawPath !== "string") return { ok: false as const, error: "Invalid path" };
      const p = await validateMdPath(rawPath);
      if (!p) return { ok: false as const, error: "File not found" };
      try {
        const content = await readFile(p, "utf8");
        if (process.platform === "darwin") {
          app.addRecentDocument(p);
        }
        ensureWatching(p);
        return {
          ok: true as const,
          path: p,
          dir: dirname(p),
          dirUrl: dirToFileUrl(dirname(p)),
          name: basename(p),
          content,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Read failed";
        return { ok: false as const, error: message };
      }
    });

    ipcMain.handle("md:resolve-link", async (_e, basePath: unknown, href: unknown): Promise<ResolvedMdLink | null> => {
      if (typeof basePath !== "string" || typeof href !== "string") return null;
      return resolveMarkdownHref(basePath, href);
    });

    ipcMain.handle("md:open-external", async (_e, url: unknown) => {
      if (typeof url !== "string") return;
      await shell.openExternal(url);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}
