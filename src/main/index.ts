import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";
import { existsSync, watch } from "node:fs";
import { readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ColorSchemePreference,
  DirTreeNode,
  ListMarkdownTreeResult,
  RenameResult,
  ResolvedMdLink,
} from "../shared/types.js";

if (!app.isPackaged) {
  app.commandLine.appendSwitch("disable-http-cache");
}

type WatchEntry = {
  handle: ReturnType<typeof watch>;
  debounce: ReturnType<typeof setTimeout> | null;
};

const fileWatchers = new Map<string, WatchEntry>();
/** Paths we just wrote, so the watcher does not reload the editor over that save. */
const ignoreFileChangesUntil = new Map<string, number>();

function noteOwnWrite(filePath: string) {
  ignoreFileChangesUntil.set(filePath, Date.now() + 1000);
}

function isOwnWriteEcho(filePath: string): boolean {
  const until = ignoreFileChangesUntil.get(filePath);
  if (until == null) return false;
  if (Date.now() <= until) return true;
  ignoreFileChangesUntil.delete(filePath);
  return false;
}
let pendingOpenPath: string | null = null;
/** First BrowserWindow created in this session; launch argv is delivered only to this window once. */
let firstCreatedWindowId: number | null = null;
/** Whether each window has at least one open file or untitled document. */
const windowHasOpenDocument = new Map<number, boolean>();
let argvLaunchHandled = false;

function extractMdFromArgv(argv: string[]): string | null {
  const sliceStart = process.defaultApp ? 2 : 1;
  const args = argv.slice(sliceStart);
  for (const a of args) {
    if (a.startsWith("-")) continue;
    const lower = a.toLowerCase();
    if (
      lower.endsWith(".md") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".mdown") ||
      lower.endsWith(".mkd")
    ) {
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

const MARKDOWN_EXTENSIONS = [".markdown", ".mdown", ".mkd", ".md"] as const;

function isMarkdownExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function markdownExtension(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(ext) && fileName.length > ext.length) return ext;
  }
  return null;
}

/** Basename to write in the file's current folder, or a status-bar error. */
function resolveRenameFileName(
  currentBase: string,
  typedName: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = typedName.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    /[\u0000-\u001f]/.test(name)
  ) {
    return { ok: false, error: "Invalid file name" };
  }
  if (Buffer.byteLength(name) > 255) {
    return { ok: false, error: "File name is too long" };
  }
  if (markdownExtension(name)) return { ok: true, name };
  if (name.includes(".")) {
    return {
      ok: false,
      error: "Use a Markdown extension (.md, .markdown, .mdown, or .mkd)",
    };
  }
  const withExt = `${name}${markdownExtension(currentBase) ?? ".md"}`;
  if (Buffer.byteLength(withExt) > 255) {
    return { ok: false, error: "File name is too long" };
  }
  return { ok: true, name: withExt };
}

const MAX_TREE_DEPTH = 48;

async function validateDirPath(dirPath: string): Promise<string | null> {
  try {
    const p = resolve(dirPath);
    const s = await stat(p);
    if (!s.isDirectory()) return null;
    return p;
  } catch {
    return null;
  }
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const rRoot = resolve(root);
  const rCand = resolve(candidate);
  if (rCand === rRoot) return true;
  const prefix = rRoot.endsWith(sep) ? rRoot : rRoot + sep;
  return rCand.startsWith(prefix);
}

async function listMarkdownDirTree(
  rootDir: string,
  currentDir: string,
  depth: number,
): Promise<DirTreeNode[]> {
  if (depth > MAX_TREE_DEPTH) return [];
  const entries = await readdir(currentDir, { withFileTypes: true });
  const nodes: DirTreeNode[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = join(currentDir, ent.name);
    if (!isPathInsideRoot(rootDir, full)) continue;
    if (ent.isDirectory()) {
      const children = await listMarkdownDirTree(rootDir, full, depth + 1);
      nodes.push({ type: "dir", name: ent.name, path: full, children });
    } else if (ent.isFile() && isMarkdownExtension(full)) {
      nodes.push({ type: "file", name: ent.name, path: full });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return nodes;
}

async function resolveMarkdownHref(
  baseFilePath: string,
  href: string,
): Promise<ResolvedMdLink | null> {
  const baseResolved = resolve(baseFilePath);
  const hRaw = href.trim();
  if (!hRaw || hRaw.toLowerCase().startsWith("javascript:")) return null;

  if (/^[a-z][a-z0-9+.-]*:/i.test(hRaw)) {
    const lower = hRaw.toLowerCase();
    if (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("mailto:")
    ) {
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

function notifyFileRenamed(
  sender: Electron.WebContents,
  from: string,
  path: string,
  dirUrl: string,
) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents === sender) continue;
    win.webContents.send("md:file-renamed", from, path, dirUrl);
  }
}

function ensureWatching(filePath: string) {
  if (fileWatchers.has(filePath)) return;
  try {
    const entry: WatchEntry = {
      handle: watch(filePath, { persistent: false }, () => {
        if (isOwnWriteEcho(filePath)) return;
        if (entry.debounce != null) clearTimeout(entry.debounce);
        entry.debounce = setTimeout(() => {
          entry.debounce = null;
          if (isOwnWriteEcho(filePath)) return;
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

function releaseWatch(filePath: string) {
  const entry = fileWatchers.get(filePath);
  if (!entry) return;
  if (entry.debounce != null) clearTimeout(entry.debounce);
  entry.debounce = null;
  try {
    entry.handle.close();
  } catch {
    // already closed
  }
  fileWatchers.delete(filePath);
}

function renameErrorMessage(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err ? err.code : undefined;
  if (code === "EEXIST") return "A file with that name already exists";
  if (code === "ENOENT") return "File not found";
  if (code === "EACCES" || code === "EPERM") return "Could not rename the file";
  return err instanceof Error ? err.message : "Rename failed";
}

function getDialogParentWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().at(-1) ??
    null
  );
}

/** Option (a): route opens to the focused window; fallback to last created window. */
function getTargetWindowForOpen(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows();
  return all.length ? all[all.length - 1]! : null;
}

/** Resolve menu / focus targets to `BrowserWindow` (menu callbacks are typed as `BaseWindow`). */
function asBrowserWindow(
  win: Electron.BaseWindow | null | undefined,
): BrowserWindow | null {
  if (win == null || win.isDestroyed()) return null;
  return BrowserWindow.fromId(win.id);
}

/** Matches `trafficLightPosition` / renderer mac title bar inset; scales with Chromium page zoom. */
const DARWIN_WINDOW_BUTTON_BASE = { x: 14, y: 14 } as const;

/**
 * Electron 43+ opens a dialog in Downloads when `defaultPath` is omitted, and
 * no longer restores the last folder the system remembered. Keep that folder
 * for the rest of the session.
 */
let lastDialogDirectory: string | undefined;

function rememberDialogDirectory(filePath: string, isDirectory = false) {
  lastDialogDirectory = isDirectory ? filePath : dirname(filePath);
}

function openDialogOptions(
  options: Electron.OpenDialogOptions,
): Electron.OpenDialogOptions {
  if (!lastDialogDirectory) return options;
  return { ...options, defaultPath: lastDialogDirectory };
}

function syncDarwinWindowButtonPositionToPageZoom(win: Electron.BaseWindow) {
  if (process.platform !== "darwin" || win.isDestroyed()) return;
  const bw = asBrowserWindow(win);
  if (!bw) return;
  const factor = bw.webContents.getZoomFactor();
  bw.setWindowButtonPosition({
    x: Math.round(DARWIN_WINDOW_BUTTON_BASE.x * factor ** 1.5),
    y: Math.round(DARWIN_WINDOW_BUTTON_BASE.y * factor ** 1.5),
  });
}

function adjustWindowZoomLevel(
  win: Electron.BaseWindow | null | undefined,
  delta: number,
) {
  const target =
    asBrowserWindow(win) ?? asBrowserWindow(BrowserWindow.getFocusedWindow());
  if (!target) return;
  const wc = target.webContents;
  wc.setZoomLevel(wc.getZoomLevel() + delta);
  syncDarwinWindowButtonPositionToPageZoom(target);
}

function resetWindowZoomLevel(win: Electron.BaseWindow | null | undefined) {
  const target =
    asBrowserWindow(win) ?? asBrowserWindow(BrowserWindow.getFocusedWindow());
  if (!target) return;
  target.webContents.setZoomLevel(0);
  syncDarwinWindowButtonPositionToPageZoom(target);
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

function isColorSchemePreference(x: unknown): x is ColorSchemePreference {
  return x === "system" || x === "light" || x === "dark";
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
    options.trafficLightPosition = { ...DARWIN_WINDOW_BUTTON_BASE };
    const windowIconPath = join(__dirname, "..", "..", "resources", "icon.icns");
    if (existsSync(windowIconPath)) {
      options.icon = windowIconPath;
    }
  }

  const win = new BrowserWindow(options);

  if (firstCreatedWindowId == null) {
    firstCreatedWindowId = win.id;
  }
  win.on("focus", () => {
    syncNewTabMenuEnabled();
    syncChromeMenu();
  });
  win.on("closed", () => {
    windowHasOpenDocument.delete(win.id);
    windowChromeState.delete(win.id);
    if (win.id === firstCreatedWindowId) {
      firstCreatedWindowId = null;
    }
    syncNewTabMenuEnabled();
    syncChromeMenu();
  });

  const devEnabled = process.env.VITE_DEV_SERVER === "1" && !app.isPackaged;
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  if (devEnabled) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  win.once("ready-to-show", () => {
    win.show();
    if (process.platform === "darwin") {
      syncDarwinWindowButtonPositionToPageZoom(win);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.platform === "darwin") {
    const syncButtons = () => syncDarwinWindowButtonPositionToPageZoom(win);
    win.webContents.on("did-finish-load", syncButtons);
    win.webContents.on("zoom-changed", syncButtons);
  }

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

function syncNewTabMenuEnabled() {
  const item = Menu.getApplicationMenu()?.getMenuItemById("new-tab");
  if (!item) return;
  const focused = BrowserWindow.getFocusedWindow();
  item.enabled = focused
    ? windowHasOpenDocument.get(focused.id) === true
    : false;
}

function setStatusBarMenuChecked(visible: boolean) {
  const item = Menu.getApplicationMenu()?.getMenuItemById("show-status-bar");
  if (!item) return;
  item.checked = visible;
}

type WindowChromeState = {
  fileTree: boolean;
  outline: boolean;
  editing: boolean;
  canEdit: boolean;
};

const windowChromeState = new Map<number, WindowChromeState>();

function chromeStateFor(id: number | undefined): WindowChromeState {
  if (id == null) {
    return { fileTree: false, outline: false, editing: false, canEdit: false };
  }
  return (
    windowChromeState.get(id) ?? {
      fileTree: false,
      outline: false,
      editing: false,
      canEdit: false,
    }
  );
}

function syncChromeMenu() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const focused = BrowserWindow.getFocusedWindow();
  const state = chromeStateFor(focused?.id);
  const fileTree = menu.getMenuItemById("show-file-tree");
  const outline = menu.getMenuItemById("show-outline");
  const edit = menu.getMenuItemById("edit-document");
  if (fileTree) fileTree.checked = state.fileTree;
  if (outline) outline.checked = state.outline;
  if (edit) {
    edit.checked = state.canEdit && state.editing;
    edit.enabled = focused != null && state.canEdit;
  }
}

function patchChromeState(win: BrowserWindow, patch: Partial<WindowChromeState>) {
  windowChromeState.set(win.id, { ...chromeStateFor(win.id), ...patch });
  if (BrowserWindow.getFocusedWindow()?.id === win.id) syncChromeMenu();
}

function broadcastStatusBarVisible(visible: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("md:status-bar-visible", visible);
  }
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
          id: "new-tab",
          label: "New tab",
          accelerator: "CmdOrCtrl+T",
          enabled: false,
          click: () => {
            const win = getTargetWindowForOpen();
            if (!win || windowHasOpenDocument.get(win.id) !== true) return;
            win.webContents.send("md:new-tab");
          },
        },
        {
          label: "New document",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            const win = getTargetWindowForOpen();
            win?.webContents.send("md:new-document");
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
            const { canceled, filePaths } = await dialog.showOpenDialog(
              win,
              openDialogOptions({
                properties: ["openFile"],
                filters: [
                  {
                    name: "Markdown",
                    extensions: ["md", "markdown", "mdown", "mkd"],
                  },
                ],
              }),
            );
            if (!canceled && filePaths[0] && !win.isDestroyed()) {
              rememberDialogDirectory(filePaths[0]);
              win.webContents.send("md:open-path", filePaths[0]);
            }
          },
        },
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            const win = getTargetWindowForOpen();
            win?.webContents.send("md:request-open-folder");
          },
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            getTargetWindowForOpen()?.webContents.send("md:save");
          },
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => {
            getTargetWindowForOpen()?.webContents.send("md:save-as");
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
        {
          label: "Find…",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            getTargetWindowForOpen()?.webContents.send("md:find");
          },
        },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          id: "show-file-tree",
          label: "Show File Tree",
          type: "checkbox",
          accelerator: "CmdOrCtrl+[",
          click: (menuItem) => {
            getTargetWindowForOpen()?.webContents.send(
              "md:file-tree-visible",
              menuItem.checked,
            );
          },
        },
        {
          id: "show-outline",
          label: "Show Outline",
          type: "checkbox",
          accelerator: "CmdOrCtrl+]",
          click: (menuItem) => {
            getTargetWindowForOpen()?.webContents.send(
              "md:outline-visible",
              menuItem.checked,
            );
          },
        },
        {
          id: "edit-document",
          label: "Edit",
          type: "checkbox",
          enabled: false,
          accelerator: "CmdOrCtrl+\\",
          click: (menuItem) => {
            getTargetWindowForOpen()?.webContents.send(
              "md:editing",
              menuItem.checked,
            );
          },
        },
        { type: "separator" },
        {
          id: "show-status-bar",
          label: "Show Status Bar",
          type: "checkbox",
          checked: true,
          click: (menuItem) => {
            broadcastStatusBarVisible(menuItem.checked);
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: (_item, browserWindow) => resetWindowZoomLevel(browserWindow),
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          acceleratorWorksWhenHidden: true,
          click: (_item, browserWindow) =>
            adjustWindowZoomLevel(browserWindow, 1),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: (_item, browserWindow) =>
            adjustWindowZoomLevel(browserWindow, -1),
        },
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

    ipcMain.handle("md:set-native-color-scheme", (_e, pref: unknown) => {
      if (!isColorSchemePreference(pref)) return;
      nativeTheme.themeSource = pref;
    });

    ipcMain.handle("md:set-has-open-document", (event, hasOpen: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      windowHasOpenDocument.set(win.id, hasOpen === true);
      if (BrowserWindow.getFocusedWindow()?.id === win.id) {
        syncNewTabMenuEnabled();
      }
    });

    ipcMain.handle("md:set-status-bar-visible", (_event, visible: unknown) => {
      setStatusBarMenuChecked(visible !== false);
    });

    ipcMain.handle("md:set-file-tree-visible", (event, visible: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      patchChromeState(win, { fileTree: visible === true });
    });

    ipcMain.handle("md:set-outline-visible", (event, visible: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      patchChromeState(win, { outline: visible === true });
    });

    ipcMain.handle(
      "md:set-editing-state",
      (event, editing: unknown, canEdit: unknown) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        patchChromeState(win, {
          editing: editing === true,
          canEdit: canEdit === true,
        });
      },
    );

    ipcMain.handle("md:new-window", () => {
      void createWindow();
    });

    ipcMain.handle("md:open-dialog", async (event) => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ?? getDialogParentWindow();
      if (!win) return null;
      const { canceled, filePaths } = await dialog.showOpenDialog(
        win,
        openDialogOptions({
          properties: ["openFile"],
          filters: [
            { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
          ],
        }),
      );
      if (canceled || !filePaths[0]) return null;
      rememberDialogDirectory(filePaths[0]);
      return filePaths[0];
    });

    ipcMain.handle("md:open-folder-dialog", async (event) => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ?? getDialogParentWindow();
      if (!win) return null;
      const { canceled, filePaths } = await dialog.showOpenDialog(
        win,
        openDialogOptions({
          properties: ["openDirectory", "createDirectory"],
        }),
      );
      if (canceled || !filePaths[0]) return null;
      const dir = await validateDirPath(filePaths[0]);
      if (dir) rememberDialogDirectory(dir, true);
      return dir;
    });

    ipcMain.handle(
      "md:list-markdown-tree",
      async (_e, rawRoot: unknown): Promise<ListMarkdownTreeResult> => {
        if (typeof rawRoot !== "string")
          return { ok: false, error: "Invalid path" };
        const root = await validateDirPath(rawRoot);
        if (!root) return { ok: false, error: "Not a folder" };
        try {
          const tree = await listMarkdownDirTree(root, root, 0);
          return { ok: true, root, tree };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Read failed";
          return { ok: false, error: message };
        }
      },
    );

    ipcMain.handle("md:normalize-path", async (_e, rawPath: unknown) => {
      if (typeof rawPath !== "string") return null;
      return validateMdPath(rawPath);
    });

    ipcMain.handle("md:read", async (_e, rawPath: unknown) => {
      if (typeof rawPath !== "string")
        return { ok: false as const, error: "Invalid path" };
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

    ipcMain.handle("md:write", async (_e, rawPath: unknown, rawContent: unknown) => {
      if (typeof rawPath !== "string" || typeof rawContent !== "string") {
        return { ok: false as const, error: "Invalid arguments" };
      }
      const p = resolve(rawPath);
      if (!isMarkdownExtension(p)) {
        return { ok: false as const, error: "Not a Markdown file" };
      }
      try {
        const parent = await stat(dirname(p));
        if (!parent.isDirectory()) {
          return { ok: false as const, error: "Folder not found" };
        }
      } catch {
        return { ok: false as const, error: "Folder not found" };
      }
      try {
        noteOwnWrite(p);
        await writeFile(p, rawContent, "utf8");
        ensureWatching(p);
        if (process.platform === "darwin") {
          app.addRecentDocument(p);
        }
        return {
          ok: true as const,
          path: p,
          dir: dirname(p),
          dirUrl: dirToFileUrl(dirname(p)),
          name: basename(p),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Save failed";
        return { ok: false as const, error: message };
      }
    });

    ipcMain.handle(
      "md:rename",
      async (event, rawFrom: unknown, rawName: unknown): Promise<RenameResult> => {
        if (typeof rawFrom !== "string" || typeof rawName !== "string") {
          return { ok: false, error: "Invalid arguments" };
        }
        const from = await validateMdPath(rawFrom);
        if (!from || !isMarkdownExtension(from)) {
          return { ok: false, error: "File not found" };
        }
        const resolved = resolveRenameFileName(basename(from), rawName);
        if (!resolved.ok) return resolved;
        const nextName = resolved.name;
        if (nextName === basename(from)) {
          return {
            ok: true,
            from,
            path: from,
            dir: dirname(from),
            dirUrl: dirToFileUrl(dirname(from)),
            name: basename(from),
          };
        }
        const dest = join(dirname(from), nextName);
        let fromReal: string;
        try {
          fromReal = await realpath(from);
        } catch {
          return { ok: false, error: "File not found" };
        }
        try {
          const destReal = await realpath(dest);
          if (destReal !== fromReal) {
            return { ok: false, error: "A file with that name already exists" };
          }
        } catch {
          // destination does not exist yet
        }
        try {
          releaseWatch(from);
          noteOwnWrite(from);
          noteOwnWrite(dest);
          await rename(from, dest);
          ensureWatching(dest);
          if (process.platform === "darwin") {
            app.addRecentDocument(dest);
          }
          const dirUrl = dirToFileUrl(dirname(dest));
          notifyFileRenamed(event.sender, from, dest, dirUrl);
          return {
            ok: true,
            from,
            path: dest,
            dir: dirname(dest),
            dirUrl,
            name: basename(dest),
          };
        } catch (err) {
          ensureWatching(from);
          return { ok: false, error: renameErrorMessage(err) };
        }
      },
    );

    ipcMain.handle("md:save-dialog", async (event, suggested: unknown) => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ?? getDialogParentWindow();
      if (!win) return null;
      const suggestedName =
        typeof suggested === "string" && suggested.trim()
          ? suggested
          : "Untitled.md";
      const defaultPath = suggestedName.includes(sep)
        ? suggestedName
        : lastDialogDirectory
          ? join(lastDialogDirectory, suggestedName)
          : suggestedName;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath,
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown", "mdown", "mkd"],
          },
        ],
      });
      if (canceled || !filePath) return null;
      const saved = isMarkdownExtension(filePath) ? filePath : `${filePath}.md`;
      rememberDialogDirectory(saved);
      return saved;
    });

    ipcMain.handle(
      "md:resolve-link",
      async (
        _e,
        basePath: unknown,
        href: unknown,
      ): Promise<ResolvedMdLink | null> => {
        if (typeof basePath !== "string" || typeof href !== "string")
          return null;
        return resolveMarkdownHref(basePath, href);
      },
    );

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
