import hljs from "highlight.js";
import { markedEmoji } from "marked-emoji";
import type { MarkedExtension } from "marked";
import nameToEmoji from "../generated/name-to-emoji.json";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mermaidSourceAttr(text: string): string {
  try {
    return escapeHtml(encodeURIComponent(text));
  } catch {
    return "";
  }
}

/** Stable id for Motion `layoutId` + host `data-markedly-expand-layout` (ASCII, URL-safe). */
export function mermaidExpandLayoutIdFromSource(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return `markedly-m-${Math.abs(h).toString(36)}`;
}

/** Fences with no ```lang``` still treat obvious Mermaid sources as diagrams (common in READMEs). */
export function firstLineLooksLikeMermaid(text: string): boolean {
  const line = text.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|sankey-beta|sankey|block-beta|block|C4Context|C4Container|C4Deployment|C4Dynamic|zenuml|packet-beta|packet|kanban|architecture(?:-beta)?|quadrantChart|requirementDiagram|xychart(?:-beta)?|treemap)\b/i.test(
    line,
  );
}

export const markedRenderingExtensions: MarkedExtension[] = [
  markedEmoji({
    emojis: nameToEmoji as Record<string, string>,
    renderer(token: { emoji: string }) {
      return token.emoji;
    },
  }),
  {
    gfm: true,
    breaks: false,
    pedantic: false,
    renderer: {
      code({ text, lang }) {
        const langTrimmed = lang?.trim() ?? "";
        if (
          langTrimmed === "mermaid" ||
          (langTrimmed === "" && firstLineLooksLikeMermaid(text))
        ) {
          const expandLayout = escapeHtml(
            mermaidExpandLayoutIdFromSource(text),
          );
          return `<div class="mermaid-host" data-markedly-expand-layout="${expandLayout}"><div class="mermaid" data-mermaid-source="${mermaidSourceAttr(text)}">${escapeHtml(text)}</div></div>`;
        }
        if (langTrimmed && hljs.getLanguage(langTrimmed)) {
          try {
            const highlighted = hljs.highlight(text, {
              language: langTrimmed,
            }).value;
            return `<pre><code class="hljs language-${escapeHtml(langTrimmed)}">${highlighted}</code></pre>`;
          } catch {
            /* fall through */
          }
        }
        return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
      },
    },
  },
];
