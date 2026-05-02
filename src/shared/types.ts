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
