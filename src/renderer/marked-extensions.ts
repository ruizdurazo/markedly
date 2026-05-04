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
        if (lang === "mermaid") {
          return `<div class="mermaid">${escapeHtml(text)}</div>`;
        }
        if (lang && hljs.getLanguage(lang)) {
          try {
            const highlighted = hljs.highlight(text, { language: lang }).value;
            return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
          } catch {
            /* fall through */
          }
        }
        return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
      },
    },
  },
];
