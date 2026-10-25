import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $getRoot,
  $isElementNode,
  type LexicalNode,
} from "lexical";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type JSX } from "react";
import type { TocEntry } from "./TocPanel";
import {
  EditorContextMenu,
  MarkdownPastePlugin,
} from "./EditorContextMenu";
import { MathBlockNode } from "./MathBlockNode";
import {
  MARKDOWN_TRANSFORMERS,
  UNDERLINE,
} from "./markdown-transformers";
import styles from "./MarkdownEditor.module.scss";

const TYPING_SHORTCUTS: Transformer[] = [
  HEADING,
  QUOTE,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  CODE,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  STRIKETHROUGH,
  UNDERLINE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
];

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  MathBlockNode,
];

const editorTheme = {
  code: "md-code-block",
  list: {
    listitemChecked: "md-task-checked",
    listitemUnchecked: "md-task",
  },
  text: {
    italic: "md-italic",
    strikethrough: "md-strike",
    underline: "md-underline",
    underlineStrikethrough: "md-underline-strike",
  },
};

type MarkdownEditorProps = {
  initialMarkdown: string;
  metadataHtml: string;
  isActive: boolean;
  onChange: (markdown: string) => void;
  onOutline: (entries: TocEntry[]) => void;
  onRoot: (root: HTMLDivElement | null) => void;
};

function collectHeadingEntries(node: LexicalNode, entries: TocEntry[]) {
  if ($isHeadingNode(node)) {
    const text = node.getTextContent().trim();
    if (!text) return;
    const level = Number.parseInt(node.getTag().slice(1), 10);
    if (!Number.isFinite(level)) return;
    entries.push({ level, text });
    return;
  }
  if (!$isElementNode(node)) return;
  for (const child of node.getChildren()) {
    collectHeadingEntries(child, entries);
  }
}

function EditorErrorBoundary({
  children,
  onError,
}: {
  children: JSX.Element;
  onError: (error: Error) => void;
}) {
  return (
    <LexicalErrorBoundary onError={onError}>{children}</LexicalErrorBoundary>
  );
}

function ExportOnChange({ onChange }: { onChange: (markdown: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const publish = () => {
      editor.getEditorState().read(() => {
        onChangeRef.current($convertToMarkdownString(MARKDOWN_TRANSFORMERS));
      });
    };
    publish();
    return editor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves, editorState }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        editorState.read(() => {
          onChangeRef.current($convertToMarkdownString(MARKDOWN_TRANSFORMERS));
        });
      },
    );
  }, [editor]);

  return null;
}

function OutlinePlugin({
  isActive,
  onOutline,
}: {
  isActive: boolean;
  onOutline: (entries: TocEntry[]) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const onOutlineRef = useRef(onOutline);
  onOutlineRef.current = onOutline;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const publish = useCallback(() => {
    if (!isActiveRef.current) return;
    const entries: TocEntry[] = [];
    editor.getEditorState().read(() => {
      collectHeadingEntries($getRoot(), entries);
    });
    onOutlineRef.current(entries);
  }, [editor]);

  useLayoutEffect(() => {
    publish();
  }, [isActive, publish]);

  useEffect(() => {
    return editor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves, editorState }) => {
        if (!isActiveRef.current) return;
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        const entries: TocEntry[] = [];
        editorState.read(() => {
          collectHeadingEntries($getRoot(), entries);
        });
        onOutlineRef.current(entries);
      },
    );
  }, [editor]);

  return null;
}

function FocusWhenActive({ isActive }: { isActive: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!isActive) return;
    const root = editor.getRootElement();
    if (!root) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    ) {
      return;
    }
    root.focus();
  }, [editor, isActive]);
  return null;
}

export function MarkdownEditor({
  initialMarkdown,
  metadataHtml,
  isActive,
  onChange,
  onOutline,
  onRoot,
}: MarkdownEditorProps) {
  const initialMarkdownRef = useRef(initialMarkdown);
  const onRootRef = useRef(onRoot);
  onRootRef.current = onRoot;

  const setRoot = useCallback((el: HTMLDivElement | null) => {
    onRootRef.current(el);
  }, []);

  const initialConfig = useMemo(
    () => ({
      namespace: "markedly",
      theme: editorTheme,
      nodes: EDITOR_NODES,
      onError(error: Error) {
        console.error(error);
      },
      editorState: () => {
        $convertFromMarkdownString(
          initialMarkdownRef.current,
          MARKDOWN_TRANSFORMERS,
        );
      },
    }),
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={styles.document}>
        {metadataHtml ? (
          <div className={styles.metadata}>
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: metadataHtml }}
            />
          </div>
        ) : null}
        <EditorContextMenu>
          <div className={styles.frame}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  ref={setRoot}
                  className={`markdown-body ${styles.editor}`}
                  aria-label="Markdown document"
                  aria-placeholder="Start writing…"
                  placeholder={
                    <div className={styles.placeholder}>Start writing…</div>
                  }
                />
              }
              ErrorBoundary={EditorErrorBoundary}
            />
          </div>
        </EditorContextMenu>
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={TYPING_SHORTCUTS} />
      <MarkdownPastePlugin />
      <ExportOnChange onChange={onChange} />
      <OutlinePlugin isActive={isActive} onOutline={onOutline} />
      <FocusWhenActive isActive={isActive} />
    </LexicalComposer>
  );
}
