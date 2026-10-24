import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import menuStyles from "./EditorContextMenu.module.scss";
import {
  normalizeRootRelativeMediaUrls,
  prepareMermaidDiagramHosts,
  renderMermaid,
} from "./lib/markdown-html";
import { MermaidDiagramHost } from "./MermaidDiagramHost";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function selectionTextWithin(root: HTMLElement | null): string {
  if (!root) return "";
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return "";
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return "";
  return selection.toString();
}

function writeClipboardText(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  });
}

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
    const copyTextRef = useRef("");
    const [canCopy, setCanCopy] = useState(false);
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

    useEffect(() => {
      const root = articleRef.current;
      if (!root) return;
      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 2) return;
        const selection = window.getSelection();
        if (
          !selection ||
          selection.rangeCount === 0 ||
          selection.isCollapsed
        ) {
          return;
        }
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        if (!(hit instanceof Node) || !root.contains(hit)) return;
        let inside = false;
        try {
          inside = range.intersectsNode(hit);
        } catch {
          inside = false;
        }
        if (!inside) return;
        event.preventDefault();
      };
      root.addEventListener("pointerdown", onPointerDown);
      return () => root.removeEventListener("pointerdown", onPointerDown);
    }, []);

    const captureSelection = () => {
      const text = selectionTextWithin(articleRef.current);
      copyTextRef.current = text;
      setCanCopy(text.length > 0);
    };

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
        .then((summary) => {
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
          if (summary.failures > 0 || summary.warnings > 0) {
            onDiagramError();
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
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <article
            ref={articleRef}
            className="markdown-body"
            aria-hidden={!isActive}
            onContextMenu={captureSelection}
          >
            <div key={mountKey} dangerouslySetInnerHTML={innerHtml} />
          </article>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuStyles.content}>
            <div className={menuStyles.scroll}>
              <ContextMenu.Item
                className={menuStyles.item}
                disabled={!canCopy}
                onSelect={() => {
                  const text = copyTextRef.current;
                  if (text) writeClipboardText(text);
                }}
              >
                <span className={menuStyles.label}>Copy</span>
                <span className={menuStyles.shortcut}>
                  {IS_MAC ? "⌘C" : "Ctrl+C"}
                </span>
              </ContextMenu.Item>
            </div>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  },
);
