import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ListMarkdownTreeResult, ReadResult, ResolvedMdLink } from "../shared/types.js";

const api = {
  newWindow: () => ipcRenderer.invoke("md:new-window") as Promise<void>,
  openDialog: () => ipcRenderer.invoke("md:open-dialog") as Promise<string | null>,
  openFolderDialog: () => ipcRenderer.invoke("md:open-folder-dialog") as Promise<string | null>,
  listMarkdownTree: (rootPath: string) =>
    ipcRenderer.invoke("md:list-markdown-tree", rootPath) as Promise<ListMarkdownTreeResult>,
  readFile: (path: string) => ipcRenderer.invoke("md:read", path) as Promise<ReadResult>,
  normalizeMarkdownPath: (path: string) =>
    ipcRenderer.invoke("md:normalize-path", path) as Promise<string | null>,
  resolveMarkdownLink: (basePath: string, href: string) =>
    ipcRenderer.invoke("md:resolve-link", basePath, href) as Promise<ResolvedMdLink | null>,
  openExternal: (url: string) => ipcRenderer.invoke("md:open-external", url) as Promise<void>,
  openLocalFile: (path: string) => ipcRenderer.invoke("md:open-local-file", path) as Promise<void>,
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
  onThemeChanged: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("md:theme-changed", fn);
    return () => ipcRenderer.removeListener("md:theme-changed", fn);
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
};

contextBridge.exposeInMainWorld("markedly", api);

export type MarkedlyApi = typeof api;
