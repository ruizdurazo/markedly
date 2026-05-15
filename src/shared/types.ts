/** Result of resolving `[text](href)` against the open Markdown file path. */
export type ResolvedMdLink =
  | { kind: "markdown"; path: string; fragment?: string }
  | { kind: "localFile"; path: string }
  | { kind: "external"; url: string }
  | { kind: "fragment"; fragment: string };

export type ReadOk = {
  ok: true;
  path: string;
  dir: string;
  /** file:// base URL for resolving relative images, trailing slash */
  dirUrl: string;
  name: string;
  content: string;
};

export type ReadErr = { ok: false; error: string };

export type ReadResult = ReadOk | ReadErr;

export type DirTreeDir = {
  type: "dir";
  name: string;
  path: string;
  children: DirTreeNode[];
};

export type DirTreeFile = {
  type: "file";
  name: string;
  path: string;
};

export type DirTreeNode = DirTreeDir | DirTreeFile;

export type ListMarkdownTreeOk = {
  ok: true;
  root: string;
  tree: DirTreeNode[];
};

export type ListMarkdownTreeErr = { ok: false; error: string };

export type ListMarkdownTreeResult = ListMarkdownTreeOk | ListMarkdownTreeErr;

/** In-app appearance: OS-driven, forced light, or forced dark. */
export type ColorSchemePreference = "system" | "light" | "dark";
