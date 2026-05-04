import { parse as parseYaml } from "yaml";

export type SplitFrontmatter = {
  body: string;
  metadata: Record<string, unknown> | null;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/** CRLF, CR-only, and Unicode line separators → `\n` so fence detection matches real editor saves. */
function normalizeNewlines(s: string): string {
  return s
    .replace(/\u2028|\u2029/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function toMetadataRecord(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  if (data instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of data) {
      o[String(k)] = v;
    }
    return o;
  }
  if (typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

const FLAT_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Plain scalar after `key:` (trimmed). Used when strict YAML rejects lines like `title: Foo: Bar`. */
function coerceFlatValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "~" || t === "null") return null;
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  return t;
}

/**
 * One key per line: split on the **first** `:`. Supports values containing `: ` (invalid for YAML plain scalars).
 * Does not handle folded/block YAML; strict parse is tried first.
 */
function parseFlatFrontmatterFallback(fmBlock: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const line of fmBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    if (!FLAT_KEY.test(key)) continue;
    const valuePart = trimmed.slice(colon + 1);
    out[key] = coerceFlatValue(valuePart);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseFrontmatterBlock(fmBlock: string): Record<string, unknown> | null {
  if (fmBlock.trim() === "") return {};

  try {
    const data = parseYaml(fmBlock) as unknown;
    const meta = toMetadataRecord(data);
    if (meta !== null) return meta;
  } catch {
    /* try flat fallback below */
  }

  const loose = parseFlatFrontmatterFallback(fmBlock);
  if (loose !== null) return loose;

  return null;
}

/**
 * If the file starts with YAML frontmatter (`---` … `---`), parse it and return the body only.
 * On invalid YAML, the full original string is returned as `body` and `metadata` is null.
 *
 * Splitting is line-based (not a single regex): leading blank lines before the opening `---`
 * are ignored; delimiter lines may have surrounding whitespace (` --- `).
 */
export function splitFrontmatter(content: string): SplitFrontmatter {
  const text = normalizeNewlines(stripBom(content));
  const rawLines = text.split("\n");

  let open = 0;
  while (open < rawLines.length && rawLines[open]!.trim() === "") {
    open++;
  }
  if (open >= rawLines.length || rawLines[open]!.trim() !== "---") {
    return { body: content, metadata: null };
  }

  let close = -1;
  for (let j = open + 1; j < rawLines.length; j++) {
    if (rawLines[j]!.trim() === "---") {
      close = j;
      break;
    }
  }
  if (close < 0) {
    return { body: content, metadata: null };
  }

  const fmBlock = rawLines.slice(open + 1, close).join("\n");
  const body = rawLines.slice(close + 1).join("\n");
  const meta = parseFrontmatterBlock(fmBlock);
  if (meta !== null) {
    return { body, metadata: meta };
  }
  return { body: content, metadata: null };
}

export function formatMetadataCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString().replace(/T.*/, "");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
