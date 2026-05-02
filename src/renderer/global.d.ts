import type { ReadResult, ResolvedMdLink } from "../shared/types.js";

declare global {
  interface Window {
    markedly: {
      newWindow: () => Promise<void>;
      openDialog: () => Promise<string | null>;
      readFile: (path: string) => Promise<ReadResult>;
      normalizeMarkdownPath: (path: string) => Promise<string | null>;
      resolveMarkdownLink: (basePath: string, href: string) => Promise<ResolvedMdLink | null>;
      openExternal: (url: string) => Promise<void>;
      openLocalFile: (path: string) => Promise<void>;
      getPathForFile: (file: File) => string;
      onOpenPath: (cb: (path: string) => void) => () => void;
      onOpenPathNewTab: (cb: (path: string) => void) => () => void;
      onFileChanged: (cb: (path: string) => void) => () => void;
      onThemeChanged: (cb: () => void) => () => void;
      onNewTab: (cb: () => void) => () => void;
      onCloseTab: (cb: () => void) => () => void;
    };
  }
}

export {};
