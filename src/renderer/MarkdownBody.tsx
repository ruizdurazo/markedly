import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  normalizeRootRelativeMediaUrls,
  prepareMermaidDiagramHosts,
  renderMermaid,
} from "./lib/markdown-html";
import { MermaidDiagramHost } from "./MermaidDiagramHost";

export type MarkdownBodyHandle = {
  getRoot: () => HTMLElement | null;
};

type MarkdownBodyProps = {
  html: string;
  /** When false, the article is only hidden with CSS so Mermaid / diagram UI stay mounted. */
  isActive: boolean;
  /** Suffix for expand-layout ids so multiple tabs with the same diagram stay unique for Motion. */
  mermaidLayoutNamespace: string;
  resolvedColorScheme: "light" | "dark";
  onDiagramError: () => void;
};

/** Stable key so React remounts the HTML shell whenever content or color mode changes (fresh Mermaid nodes). */
function markdownMountKey(html: string, resolvedColorScheme: string): string {
  let h = 0;
  for (let i = 0; i < html.length; i += 1) {
    h = (Math.imul(31, h) + html.charCodeAt(i)) | 0;
  }
  return `${resolvedColorScheme}:${html.length}:${h}`;
}

export const MarkdownBody = forwardRef<MarkdownBodyHandle, MarkdownBodyProps>(
  function MarkdownBody(
    {
      html,
      isActive,
      mermaidLayoutNamespace,
      resolvedColorScheme,
      onDiagramError,
    },
    imperativeRef,
  ) {
    const articleRef = useRef<HTMLElement>(null);
    const diagramRootsRef = useRef<Root[]>([]);
    const mountKey = useMemo(
      () => markdownMountKey(html, resolvedColorScheme),
      [html, resolvedColorScheme],
    );
    const innerHtml = useMemo(() => ({ __html: html }), [html]);

    useImperativeHandle(imperativeRef, () => ({
      getRoot: () =>
        (articleRef.current?.firstElementChild as HTMLElement | null) ??
        articleRef.current,
    }));

    useLayoutEffect(() => {
      if (!articleRef.current || !html) return;
      const root =
        (articleRef.current.firstElementChild as HTMLElement | null) ??
        articleRef.current;
      for (const r of diagramRootsRef.current) {
        r.unmount();
      }
      diagramRootsRef.current = [];
      normalizeRootRelativeMediaUrls(root);
      for (const el of root.querySelectorAll<HTMLElement>(
        "[data-markedly-expand-layout]",
      )) {
        const b = el.dataset.markedlyExpandLayout?.trim();
        if (b && !b.includes("__tab__")) {
          el.dataset.markedlyExpandLayout = `${b}__tab__${mermaidLayoutNamespace}`;
        }
      }
      prepareMermaidDiagramHosts(root);
      let cancelled = false;
      void renderMermaid(root, resolvedColorScheme)
        .then(() => {
          if (cancelled) return;
          let expandIndex = 0;
          for (const bridge of root.querySelectorAll<HTMLElement>(
            ".mermaid-host__bridge",
          )) {
            const host = bridge.closest<HTMLElement>(".mermaid-host");
            const mermaid = host?.querySelector(":scope > .mermaid");
            const baseLayoutId = host?.dataset.markedlyExpandLayout?.trim();
            if (
              !(mermaid instanceof HTMLDivElement) ||
              !baseLayoutId ||
              mermaid.classList.contains("mermaid--error") ||
              !mermaid.querySelector(":scope > svg")
            ) {
              continue;
            }
            const layoutId = `${baseLayoutId}-${expandIndex}`;
            expandIndex += 1;
            const reactRoot = createRoot(bridge);
            diagramRootsRef.current.push(reactRoot);
            reactRoot.render(
              <MermaidDiagramHost layoutId={layoutId} mermaidEl={mermaid} />,
            );
          }
        })
        .catch(() => {
          if (!cancelled) onDiagramError();
        });
      return () => {
        cancelled = true;
        for (const r of diagramRootsRef.current) {
          r.unmount();
        }
        diagramRootsRef.current = [];
      };
    }, [
      html,
      mountKey,
      mermaidLayoutNamespace,
      onDiagramError,
      resolvedColorScheme,
    ]);

    return (
      <article
        ref={articleRef}
        className="markdown-body"
        aria-hidden={!isActive}
      >
        <div key={mountKey} dangerouslySetInnerHTML={innerHtml} />
      </article>
    );
  },
);
