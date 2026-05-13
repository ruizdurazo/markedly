import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import {
  normalizeRootRelativeMediaUrls,
  renderMermaid,
} from "./lib/markdown-html";

export type MarkdownBodyHandle = {
  getRoot: () => HTMLElement | null;
};

type MarkdownBodyProps = {
  html: string;
  hidden: boolean;
  onDiagramError: () => void;
};

export const MarkdownBody = forwardRef<MarkdownBodyHandle, MarkdownBodyProps>(
  function MarkdownBody({ html, hidden, onDiagramError }, imperativeRef) {
    const articleRef = useRef<HTMLElement>(null);

    useImperativeHandle(imperativeRef, () => ({
      getRoot: () => articleRef.current,
    }));

    useLayoutEffect(() => {
      if (hidden || !articleRef.current || !html) return;
      const root = articleRef.current;
      normalizeRootRelativeMediaUrls(root);
      let cancelled = false;
      void renderMermaid(root)
        .then(() => {
          if (cancelled) return;
        })
        .catch(() => {
          if (!cancelled) onDiagramError();
        });
      return () => {
        cancelled = true;
      };
    }, [html, hidden, onDiagramError]);

    return (
      <article
        ref={articleRef}
        className="markdown-body"
        hidden={hidden}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
);
