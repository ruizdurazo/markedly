import { firstLineLooksLikeMermaid } from "../marked-extensions.js";

type FenceState = { markerChar: "`" | "~"; openLen: number };

function parseFenceOpen(line: string): FenceState | null {
  const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const marker = m[2];
  const c = marker[0];
  if (c !== "`" && c !== "~") return null;
  return { markerChar: c as "`" | "~", openLen: marker.length };
}

function isFenceClose(line: string, st: FenceState): boolean {
  const re =
    st.markerChar === "`"
      ? new RegExp(`^\\s*\`{${st.openLen},}\\s*$`)
      : new RegExp(`^\\s*~{${st.openLen},}\\s*$`);
  return re.test(line);
}

/**
 * Heuristic for a normal Markdown paragraph that is actually Mermaid source (no ``` fence).
 * flowchart/graph are checked more strictly so prose like "Flowchart of sales…" is not wrapped.
 */
function looksLikeBareMermaidParagraph(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (!firstLineLooksLikeMermaid(t)) return false;
  const firstLine = (t.split(/\r?\n/, 1)[0] ?? "").trim();
  if (!/^(flowchart|graph)\b/i.test(firstLine)) return true;
  if (/^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.test(firstLine)) return true;
  return /-->|subgraph|\.{2,}|\[[^\n]{0,240}\]/.test(t);
}

/**
 * Wraps bare Mermaid blocks (no fenced code) in ```mermaid fences so `marked` emits `.mermaid` divs.
 * Tracks fenced regions so content inside real code fences is not modified.
 */
export function wrapBareMermaidMarkdown(source: string): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let fence: FenceState | null = null;
  let para: string[] = [];

  const flushParagraph = (): void => {
    if (para.length === 0) return;
    const text = para.join("\n");
    if (looksLikeBareMermaidParagraph(text)) {
      out.push("```mermaid", text, "```");
    } else {
      out.push(...para);
    }
    para = [];
  };

  for (const line of lines) {
    if (fence) {
      out.push(line);
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }

    const open = parseFenceOpen(line);
    if (open) {
      flushParagraph();
      out.push(line);
      fence = open;
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      out.push(line);
    } else {
      para.push(line);
    }
  }
  flushParagraph();
  return out.join(eol);
}
