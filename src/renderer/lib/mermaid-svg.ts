const MERMAID_ERROR_VIEWBOX = "0 0 2412 512";

/** Mermaid render() appends temporary nodes to document.body; they can leak on throw. */
export function cleanupMermaidRenderContainers(): void {
  for (const el of document.querySelectorAll(
    'body > div[id^="dmarkedly-mermaid-"], body > iframe[id^="imarkedly-mermaid-"]',
  )) {
    el.remove();
  }
}

export type MermaidSvgPostprocess = {
  html: string;
  /** Mermaid's full-screen syntax error diagram (no real chart). */
  isErrorOnly: boolean;
  /** Layout/render warning overlay removed from an otherwise valid chart. */
  hadEmbeddedError: boolean;
};

function extractSvgMarkup(html: string): string {
  const match = /<svg\b[\s\S]*<\/svg>/i.exec(html);
  return match?.[0] ?? html;
}

function hasMermaidGraphContent(svg: string): boolean {
  return (
    /\bclass="[^"]*\b(?:node|actor|edgeLabel|flowchart-link|cluster)\b/.test(svg) ||
    /\bid="flowchart-/.test(svg) ||
    /<g[^>]*class="[^"]*\broot\b/.test(svg)
  );
}

/** Detect Mermaid's built-in syntax-error SVG (see errorRenderer in mermaid). */
export function isMermaidErrorOnlySvg(html: string): boolean {
  if (!html.includes("Syntax error in text")) {
    return false;
  }
  const svg = extractSvgMarkup(html);
  if (
    new RegExp(
      `viewBox=["']${MERMAID_ERROR_VIEWBOX.replace(/ /g, "\\s+")}["']`,
    ).test(svg)
  ) {
    return true;
  }
  return !hasMermaidGraphContent(svg);
}

/** Strip Mermaid's inline error banner (works on `<style>` + `<svg>` bundles). */
export function stripMermaidErrorElements(html: string): string {
  let out = html;
  out = out.replace(
    /<text\b[^>]*\bclass="error-text"[^>]*>[\s\S]*?<\/text>/gi,
    "",
  );
  out = out.replace(/<path\b[^>]*\bclass="error-icon"[^>]*\/?>\s*/gi, "");
  out = out.replace(
    /<text\b[^>]*>[\s\S]*?Syntax error in text[\s\S]*?<\/text>/gi,
    "",
  );
  out = out.replace(
    /<text\b[^>]*>[\s\S]*?mermaid version[\s\S]*?<\/text>/gi,
    "",
  );
  return out;
}

export function postprocessMermaidSvg(html: string): MermaidSvgPostprocess {
  const hasError =
    html.includes("error-text") ||
    html.includes("error-icon") ||
    html.includes("Syntax error in text");

  if (!hasError) {
    return { html, isErrorOnly: false, hadEmbeddedError: false };
  }

  if (isMermaidErrorOnlySvg(html)) {
    return { html, isErrorOnly: true, hadEmbeddedError: false };
  }

  const stripped = stripMermaidErrorElements(html);
  const stillShowsError = stripped.includes("Syntax error in text");

  return {
    html: stillShowsError ? html : stripped,
    isErrorOnly: stillShowsError,
    hadEmbeddedError: !stillShowsError && hasError,
  };
}
