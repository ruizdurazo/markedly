import type {
  ColorSchemePreference,
  ListMarkdownTreeResult,
  ReadResult,
  RenameResult,
  ResolvedMdLink,
  WriteResult,
} from "../shared/types.js";

declare global {
  interface Window {
    markedly: {
      newWindow: () => Promise<void>;
      openDialog: () => Promise<string | null>;
      openFolderDialog: () => Promise<string | null>;
      listMarkdownTree: (rootPath: string) => Promise<ListMarkdownTreeResult>;
      readFile: (path: string) => Promise<ReadResult>;
      writeFile: (path: string, content: string) => Promise<WriteResult>;
      renameFile: (path: string, name: string) => Promise<RenameResult>;
      saveDialog: (suggestedName: string) => Promise<string | null>;
      normalizeMarkdownPath: (path: string) => Promise<string | null>;
      resolveMarkdownLink: (
        basePath: string,
        href: string,
      ) => Promise<ResolvedMdLink | null>;
      openExternal: (url: string) => Promise<void>;
      openLocalFile: (path: string) => Promise<void>;
      getPathForFile: (file: File) => string;
      onOpenPath: (cb: (path: string) => void) => () => void;
      onOpenPathNewTab: (cb: (path: string) => void) => () => void;
      onFileChanged: (cb: (path: string) => void) => () => void;
      onFileRenamed: (
        cb: (from: string, path: string, dirUrl: string) => void,
      ) => () => void;
      onThemeChanged: (cb: () => void) => () => void;
      setNativeColorScheme: (pref: ColorSchemePreference) => Promise<void>;
      setHasOpenDocument: (hasOpenDocument: boolean) => Promise<void>;
      setStatusBarVisible: (visible: boolean) => Promise<void>;
      setFileTreeVisible: (visible: boolean) => Promise<void>;
      setOutlineVisible: (visible: boolean) => Promise<void>;
      setEditingState: (editing: boolean, canEdit: boolean) => Promise<void>;
      onFileTreeVisible: (cb: (visible: boolean) => void) => () => void;
      onOutlineVisible: (cb: (visible: boolean) => void) => () => void;
      onEditing: (cb: (editing: boolean) => void) => () => void;
      onStatusBarVisible: (cb: (visible: boolean) => void) => () => void;
      onNewTab: (cb: () => void) => () => void;
      onCloseTab: (cb: () => void) => () => void;
      onRequestOpenFolder: (cb: () => void) => () => void;
      onFind: (cb: () => void) => () => void;
      onSave: (cb: () => void) => () => void;
      onSaveAs: (cb: () => void) => () => void;
      onNewDocument: (cb: () => void) => () => void;
    };
  }
}

export {};
