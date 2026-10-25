import {
  $generateNodesFromMarkdownString,
  CHECK_LIST,
  CODE,
  HEADING,
  ORDERED_LIST,
  QUOTE,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  UNORDERED_LIST,
  type MultilineElementTransformer,
  type TextFormatTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createTextNode,
  $isParagraphNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import {
  $createMathBlockNode,
  $isMathBlockNode,
  MathBlockNode,
} from "./MathBlockNode";

/** CommonMark has no underline. `++text++` is the form this editor writes. */
export const UNDERLINE: TextFormatTransformer = {
  format: ["underline"],
  tag: "++",
  type: "text-format",
};

function displayMath(
  open: string,
  close: string,
  exportNode: boolean,
): MultilineElementTransformer {
  const escapedOpen = open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedClose = close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    dependencies: [MathBlockNode],
    export: exportNode
      ? (node) => ($isMathBlockNode(node) ? node.getTextContent() : null)
      : undefined,
    regExpEnd: new RegExp(`^${escapedClose}\\s*$`),
    regExpStart: new RegExp(`^${escapedOpen}\\s*$`),
    replace: (
      rootNode: ElementNode,
      _children,
      _startMatch,
      endMatch,
      linesInBetween,
      isImport,
    ) => {
      if (!isImport || linesInBetween == null || endMatch == null) return false;
      const lines = linesInBetween.slice();
      if (lines[0] === "") lines.shift();
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      const math = $createMathBlockNode();
      math.append($createTextNode(`${open}\n${lines.join("\n")}\n${close}`));
      rootNode.append(math);
    },
    type: "multiline-element",
  };
}

/** `\\[ ... \\]` and `$$ ... $$` on their own lines. Export writes the source back unchanged. */
const DISPLAY_MATH_BRACKET = displayMath("\\[", "\\]", true);
const DISPLAY_MATH_DOLLAR = displayMath("$$", "$$", false);

const MATH_SHIELD = /^\uE000math(\d+)\uE001$/;

function fenceLength(line: string): number {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
  return match ? match[1].length : 0;
}

function isClosingFence(line: string, length: number): boolean {
  const match = /^[ \t]{0,3}(`+|~+)[ \t]*$/.exec(line);
  return match != null && match[1].length >= length;
}

function mathDelimiter(line: string): "\\[" | "\\]" | "$$" | null {
  const trimmed = line.trim();
  if (trimmed === "\\[") return "\\[";
  if (trimmed === "\\]") return "\\]";
  if (trimmed === "$$") return "$$";
  return null;
}

/**
 * Pull display-math blocks out before Lexical merges adjacent lines. The
 * placeholder is a single line, so the formula is not joined with the
 * paragraph around it and its backslashes are not treated as escapes.
 */
function shieldDisplayMath(markdown: string): { text: string; blocks: string[] } {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  const out: string[] = [];
  let fence = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence > 0) {
      if (isClosingFence(line, fence)) fence = 0;
      out.push(line);
      continue;
    }
    const opened = fenceLength(line);
    if (opened > 0) {
      fence = opened;
      out.push(line);
      continue;
    }
    const open = mathDelimiter(line);
    if (open !== "\\[" && open !== "$$") {
      out.push(line);
      continue;
    }
    const close = open === "\\[" ? "\\]" : "$$";
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (fenceLength(lines[j] ?? "") > 0) break;
      if (mathDelimiter(lines[j] ?? "") === close) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      out.push(line);
      continue;
    }
    const id = blocks.length;
    const inner = lines.slice(i + 1, end).join("\n");
    blocks.push(`${open}\n${inner}\n${close}`);
    out.push(`\uE000math${id}\uE001`);
    i = end;
  }

  return { text: out.join("\n"), blocks };
}

function restoreShieldedMath(nodes: LexicalNode[], blocks: string[]): LexicalNode[] {
  if (blocks.length === 0) return nodes;
  return nodes.map((node) => {
    if (!$isParagraphNode(node)) return node;
    const match = MATH_SHIELD.exec(node.getTextContent().trim());
    if (!match) return node;
    const source = blocks[Number(match[1])];
    if (source == null) return node;
    const math = $createMathBlockNode();
    math.append($createTextNode(source));
    return math;
  });
}

/** Parse markdown into editor nodes, including display math and wrapped paragraphs. */
export function $importMarkdownClipboard(markdown: string): LexicalNode[] {
  const shielded = shieldDisplayMath(markdown);
  const nodes = $generateNodesFromMarkdownString(
    shielded.text,
    MARKDOWN_TRANSFORMERS,
    false,
    true,
  );
  return restoreShieldedMath(nodes, shielded.blocks);
}

export const MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING,
  QUOTE,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  DISPLAY_MATH_BRACKET,
  DISPLAY_MATH_DOLLAR,
  CODE,
  ...TEXT_FORMAT_TRANSFORMERS,
  UNDERLINE,
  ...TEXT_MATCH_TRANSFORMERS,
];
