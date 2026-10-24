import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  ColorSchemePreference,
  KnownFolderId,
  ListMarkdownTreeResult,
  ReadResult,
  RenameResult,
  ResolvedMdLink,
  WriteResult,
} from "../shared/types.js";

const api = {
  newWindow: () => ipcRenderer.invoke("md:new-window") as Promise<void>,
  openDialog: () =>
    ipcRenderer.invoke("md:open-dialog") as Promise<string | null>,
  openFolderDialog: () =>
    ipcRenderer.invoke("md:open-folder-dialog") as Promise<string | null>,
  knownFolder: (id: KnownFolderId) =>
    ipcRenderer.invoke("md:known-folder", id) as Promise<string | null>,
  listMarkdownTree: (rootPath: string) =>
    ipcRenderer.invoke(
      "md:list-markdown-tree",
      rootPath,
    ) as Promise<ListMarkdownTreeResult>,
  readFile: (path: string) =>
    ipcRenderer.invoke("md:read", path) as Promise<ReadResult>,
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke("md:write", path, content) as Promise<WriteResult>,
  renameFile: (path: string, name: string) =>
    ipcRenderer.invoke("md:rename", path, name) as Promise<RenameResult>,
  saveDialog: (suggestedName: string) =>
    ipcRenderer.invoke("md:save-dialog", suggestedName) as Promise<
      string | null
    >,
  normalizeMarkdownPath: (path: string) =>
    ipcRenderer.invoke("md:normalize-path", path) as Promise<string | null>,
  resolveMarkdownLink: (basePath: string, href: string) =>
    ipcRenderer.invoke(
      "md:resolve-link",
      basePath,
      href,
    ) as Promise<ResolvedMdLink | null>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("md:open-external", url) as Promise<void>,
  openLocalFile: (path: string) =>
    ipcRenderer.invoke("md:open-local-file", path) as Promise<void>,
  /** Native path for a dropped `File` (required with sandbox; `file.path` is unreliable). */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onOpenPath: (cb: (path: string) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on("md:open-path", fn);
    return () => ipcRenderer.removeListener("md:open-path", fn);
  },
  onOpenPathNewTab: (cb: (path: string) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on("md:open-path-new-tab", fn);
    return () => ipcRenderer.removeListener("md:open-path-new-tab", fn);
  },
  onFileChanged: (cb: (path: string) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on("md:file-changed", fn);
    return () => ipcRenderer.removeListener("md:file-changed", fn);
  },
  onFileRenamed: (cb: (from: string, path: string, dirUrl: string) => void) => {
    const fn = (
      _e: Electron.IpcRendererEvent,
      from: string,
      path: string,
      dirUrl: string,
    ) => cb(from, path, dirUrl);
    ipcRenderer.on("md:file-renamed", fn);
    return () => ipcRenderer.removeListener("md:file-renamed", fn);
  },
  onThemeChanged: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:theme-changed", fn);
    return () => ipcRenderer.removeListener("md:theme-changed", fn);
  },
  setNativeColorScheme: (pref: ColorSchemePreference) =>
    ipcRenderer.invoke("md:set-native-color-scheme", pref) as Promise<void>,
  setHasOpenDocument: (hasOpenDocument: boolean) =>
    ipcRenderer.invoke(
      "md:set-has-open-document",
      hasOpenDocument,
    ) as Promise<void>,
  setStatusBarVisible: (visible: boolean) =>
    ipcRenderer.invoke("md:set-status-bar-visible", visible) as Promise<void>,
  setFileTreeVisible: (visible: boolean) =>
    ipcRenderer.invoke("md:set-file-tree-visible", visible) as Promise<void>,
  setOutlineVisible: (visible: boolean) =>
    ipcRenderer.invoke("md:set-outline-visible", visible) as Promise<void>,
  setEditingState: (editing: boolean, canEdit: boolean) =>
    ipcRenderer.invoke(
      "md:set-editing-state",
      editing,
      canEdit,
    ) as Promise<void>,
  onFileTreeVisible: (cb: (visible: boolean) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, visible: boolean) =>
      cb(visible);
    ipcRenderer.on("md:file-tree-visible", fn);
    return () => ipcRenderer.removeListener("md:file-tree-visible", fn);
  },
  onOutlineVisible: (cb: (visible: boolean) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, visible: boolean) =>
      cb(visible);
    ipcRenderer.on("md:outline-visible", fn);
    return () => ipcRenderer.removeListener("md:outline-visible", fn);
  },
  onEditing: (cb: (editing: boolean) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, editing: boolean) =>
      cb(editing);
    ipcRenderer.on("md:editing", fn);
    return () => ipcRenderer.removeListener("md:editing", fn);
  },
  onStatusBarVisible: (cb: (visible: boolean) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, visible: boolean) => cb(visible);
    ipcRenderer.on("md:status-bar-visible", fn);
    return () => ipcRenderer.removeListener("md:status-bar-visible", fn);
  },
  onNewTab: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:new-tab", fn);
    return () => ipcRenderer.removeListener("md:new-tab", fn);
  },
  onCloseTab: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:close-tab", fn);
    return () => ipcRenderer.removeListener("md:close-tab", fn);
  },
  onRequestOpenFolder: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:request-open-folder", fn);
    return () => ipcRenderer.removeListener("md:request-open-folder", fn);
  },
  onFind: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:find", fn);
    return () => ipcRenderer.removeListener("md:find", fn);
  },
  onSave: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:save", fn);
    return () => ipcRenderer.removeListener("md:save", fn);
  },
  onSaveAs: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:save-as", fn);
    return () => ipcRenderer.removeListener("md:save-as", fn);
  },
  onNewDocument: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:new-document", fn);
    return () => ipcRenderer.removeListener("md:new-document", fn);
  },
};

contextBridge.exposeInMainWorld("markedly", api);

export type MarkedlyApi = typeof api;
