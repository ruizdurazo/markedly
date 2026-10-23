import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $insertDataTransferForRichText } from "@lexical/clipboard";
import {
  $insertList,
  $isListNode,
  $removeList,
  ListNode,
} from "@lexical/list";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $findMatchingParent, $getNearestNodeOfType } from "@lexical/utils";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Bold,
  Code,
  CodeBrackets,
  Italic,
  Link,
  List,
  NumberedListLeft,
  Quote,
  TaskList,
  Strikethrough,
  Underline,
  Xmark,
} from "iconoir-react";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COPY_COMMAND,
  CUT_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import styles from "./EditorContextMenu.module.scss";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function keys(key: string, shift = false, alt = false): string {
  if (IS_MAC) return `⌘${alt ? "⌥" : ""}${shift ? "⇧" : ""}${key}`;
  return `Ctrl+${alt ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}

const HEADING_TAGS: HeadingTagType[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

function styleIcon(Icon: typeof Bold) {
  return <Icon width={16} height={16} strokeWidth={2} aria-hidden />;
}

function insertPlainText(editor: LexicalEditor, text: string) {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  editor.update(() => {
    const selection = $getSelection();
    if (selection == null) return;
    $insertDataTransferForRichText(data, selection, editor);
  });
}

function linkFromSelection(selection: RangeSelection) {
  const node = selection.anchor.getNode();
  if ($isLinkNode(node)) return node;
  return $findMatchingParent(node, $isLinkNode);
}

const LINK_BAR_WIDTH = 320;
const LINK_BAR_HEIGHT = 40;

function placeLinkEditor(rect: DOMRect): { top: number; left: number } {
  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - LINK_BAR_WIDTH - 8),
  );
  const below = rect.bottom + 4;
  const top =
    below + LINK_BAR_HEIGHT > window.innerHeight && rect.top > LINK_BAR_HEIGHT + 8
      ? rect.top - LINK_BAR_HEIGHT - 4
      : below;
  return { top: Math.round(top), left: Math.round(left) };
}

function listTypeFromSelection(
  selection: RangeSelection,
): "bullet" | "number" | "check" | null {
  const list = $getNearestNodeOfType(selection.anchor.getNode(), ListNode);
  if (!$isListNode(list)) return null;
  const type = list.getListType();
  if (type === "bullet" || type === "number" || type === "check") return type;
  return null;
}

function inCodeBlock(selection: RangeSelection): boolean {
  const node = selection.anchor.getNode();
  return $isCodeNode(node) || $findMatchingParent(node, $isCodeNode) != null;
}

function inQuote(selection: RangeSelection): boolean {
  const node = selection.anchor.getNode();
  return $isQuoteNode(node) || $findMatchingParent(node, $isQuoteNode) != null;
}

function headingTagFromSelection(
  selection: RangeSelection,
): HeadingTagType | null {
  const node = selection.anchor.getNode();
  const heading = $isHeadingNode(node)
    ? node
    : $findMatchingParent(node, $isHeadingNode);
  return $isHeadingNode(heading) ? heading.getTag() : null;
}

function toggleHeading(editor: LexicalEditor, tag: HeadingTagType) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const current = headingTagFromSelection(selection);
    $setBlocksType(selection, () =>
      current === tag ? $createParagraphNode() : $createHeadingNode(tag),
    );
  });
}

function toggleList(
  editor: LexicalEditor,
  kind: "bullet" | "number" | "check",
) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    if (listTypeFromSelection(selection) === kind) $removeList();
    else $insertList(kind);
  });
}

function toggleCodeBlock(editor: LexicalEditor) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const toParagraph = inCodeBlock(selection);
    $setBlocksType(selection, () =>
      toParagraph ? $createParagraphNode() : $createCodeNode(),
    );
  });
}

function toggleQuote(editor: LexicalEditor) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const toParagraph = inQuote(selection);
    $setBlocksType(selection, () =>
      toParagraph ? $createParagraphNode() : $createQuoteNode(),
    );
  });
}

function normalizeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url || /^(javascript|data):/i.test(url)) return null;
  return url;
}

function PreserveSelectionOnRightClick() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let detach = () => {};
    const unregister = editor.registerRootListener((root) => {
      detach();
      detach = () => {};
      if (!root) return;
      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 2) return;
        const domSelection = window.getSelection();
        if (
          !domSelection ||
          domSelection.rangeCount === 0 ||
          domSelection.isCollapsed
        ) {
          return;
        }
        const range = domSelection.getRangeAt(0);
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
      detach = () => root.removeEventListener("pointerdown", onPointerDown);
    });
    return () => {
      detach();
      unregister();
    };
  }, [editor]);
  return null;
}

export function PlainTextPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        event.preventDefault();
        insertPlainText(editor, text);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);
  return null;
}

type EditorContextMenuProps = {
  children: ReactNode;
};

type LinkPrompt = {
  url: string;
  hadLink: boolean;
};

type CaretLink = {
  key: string;
  url: string;
  top: number;
  left: number;
};

export function EditorContextMenu({ children }: EditorContextMenuProps) {
  const [editor] = useLexicalComposerContext();
  const [canFormat, setCanFormat] = useState(true);
  const [canCopy, setCanCopy] = useState(false);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [strike, setStrike] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [code, setCode] = useState(false);
  const [codeBlock, setCodeBlock] = useState(false);
  const [quote, setQuote] = useState(false);
  const [heading, setHeading] = useState<HeadingTagType | null>(null);
  const [bullet, setBullet] = useState(false);
  const [numbered, setNumbered] = useState(false);
  const [todo, setTodo] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<LinkPrompt | null>(null);
  const [caretLink, setCaretLink] = useState<CaretLink | null>(null);
  const linkFieldFocused = useRef(false);
  const skipLinkCommit = useRef(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const readSelection = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setCanFormat(false);
          setCanCopy(false);
          setBold(false);
          setItalic(false);
          setStrike(false);
          setUnderline(false);
          setCode(false);
          setCodeBlock(false);
          setQuote(false);
          setHeading(null);
          setBullet(false);
          setNumbered(false);
          setTodo(false);
          setLinkUrl(null);
          if (!linkFieldFocused.current) setCaretLink(null);
          return;
        }
        const listType = listTypeFromSelection(selection);
        const link = linkFromSelection(selection);
        const caretInLink = selection.isCollapsed() && link != null;
        if (caretInLink && link) {
          const key = link.getKey();
          const url = link.getURL();
          const element = editor.getElementByKey(key);
          const place = element
            ? placeLinkEditor(element.getBoundingClientRect())
            : null;
          setCaretLink((prev) => {
            if (linkFieldFocused.current && prev?.key === key) {
              return place
                ? { ...prev, top: place.top, left: place.left }
                : prev;
            }
            const next: CaretLink = {
              key,
              url,
              top: place?.top ?? prev?.top ?? 8,
              left: place?.left ?? prev?.left ?? 8,
            };
            if (
              prev &&
              prev.key === next.key &&
              prev.url === next.url &&
              prev.top === next.top &&
              prev.left === next.left
            ) {
              return prev;
            }
            return next;
          });
        } else if (!linkFieldFocused.current) {
          setCaretLink(null);
        }
        setCanFormat(true);
        setCanCopy(!selection.isCollapsed());
        setBold(selection.hasFormat("bold"));
        setItalic(selection.hasFormat("italic"));
        setStrike(selection.hasFormat("strikethrough"));
        setUnderline(selection.hasFormat("underline"));
        setCode(selection.hasFormat("code"));
        setCodeBlock(inCodeBlock(selection));
        setQuote(inQuote(selection));
        setHeading(headingTagFromSelection(selection));
        setBullet(listType === "bullet");
        setNumbered(listType === "number");
        setTodo(listType === "check");
        setLinkUrl(link?.getURL() ?? null);
      });
    };
    readSelection();
    const removeSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        readSelection();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const removeUpdate = editor.registerUpdateListener(() => {
      readSelection();
    });
    return () => {
      removeSelection();
      removeUpdate();
    };
  }, [editor]);

  useEffect(() => {
    if (!caretLink) return;
    const linkKey = caretLink.key;
    const reposition = () => {
      const element = editor.getElementByKey(linkKey);
      if (!element) return;
      const place = placeLinkEditor(element.getBoundingClientRect());
      setCaretLink((prev) =>
        prev && prev.key === linkKey ? { ...prev, ...place } : prev,
      );
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [caretLink?.key, editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return false;
        const headingDigit = /^Digit([1-6])$/.exec(event.code);
        if (event.altKey && !event.shiftKey && headingDigit) {
          const tag = HEADING_TAGS[Number(headingDigit[1]) - 1];
          if (!tag) return false;
          event.preventDefault();
          toggleHeading(editor, tag);
          return true;
        }
        if (event.altKey) return false;
        const shifted = event.shiftKey;
        if (shifted && event.code === "KeyX") {
          event.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
          return true;
        }
        if (!shifted && event.code === "KeyU") {
          event.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
          return true;
        }
        if (!shifted && event.code === "KeyE") {
          event.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
          return true;
        }
        if (shifted && event.code === "KeyE") {
          event.preventDefault();
          toggleCodeBlock(editor);
          return true;
        }
        if (!shifted && event.code === "Quote") {
          event.preventDefault();
          toggleQuote(editor);
          return true;
        }
        if (shifted && event.code === "Digit8") {
          event.preventDefault();
          toggleList(editor, "bullet");
          return true;
        }
        if (shifted && event.code === "Digit7") {
          event.preventDefault();
          toggleList(editor, "number");
          return true;
        }
        if (shifted && event.code === "Digit9") {
          event.preventDefault();
          toggleList(editor, "check");
          return true;
        }
        if (!shifted && event.code === "KeyK") {
          event.preventDefault();
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            const inLink =
              $isRangeSelection(selection) &&
              selection.isCollapsed() &&
              linkFromSelection(selection) != null;
            if (inLink) {
              linkFieldFocused.current = true;
              queueMicrotask(() => {
                linkInputRef.current?.focus();
                linkInputRef.current?.select();
              });
            } else {
              openLinkPrompt();
            }
          });
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  const run = (command: () => void) => {
    editor.focus(() => {
      command();
    });
  };

  const format = (kind: TextFormatType) => {
    run(() => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, kind);
    });
  };

  const openLinkPrompt = () => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const url =
        $isRangeSelection(selection)
          ? (linkFromSelection(selection)?.getURL() ?? "")
          : "";
      setLinkPrompt({ url, hadLink: url.length > 0 });
    });
  };

  const applyLink = (raw: string) => {
    const url = normalizeLinkUrl(raw);
    setLinkPrompt(null);
    if (!url) return;
    editor.focus(() => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (selection.isCollapsed() && linkFromSelection(selection) == null) {
          const text = $createTextNode(url);
          selection.insertNodes([text]);
          text.select(0, text.getTextContentSize());
        }
      });
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    });
  };

  const removeLink = () => {
    setLinkPrompt(null);
    editor.focus(() => {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    });
  };

  const commitCaretLink = (raw: string) => {
    const current = caretLink;
    if (!current) return;
    const url = normalizeLinkUrl(raw);
    if (url && url !== current.url) {
      editor.update(() => {
        const node = $getNodeByKey(current.key);
        if ($isLinkNode(node)) node.setURL(url);
      });
    }
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const still =
        $isRangeSelection(selection) &&
        selection.isCollapsed() &&
        linkFromSelection(selection)?.getKey() === current.key;
      if (!still && !linkFieldFocused.current) setCaretLink(null);
    });
  };

  const removeCaretLink = () => {
    skipLinkCommit.current = true;
    linkFieldFocused.current = false;
    const key = caretLink?.key;
    setCaretLink(null);
    editor.focus(() => {
      editor.update(() => {
        const node = key ? $getNodeByKey(key) : null;
        if (!$isLinkNode(node)) return;
        const selection = $getSelection();
        const inside =
          $isRangeSelection(selection) &&
          linkFromSelection(selection)?.getKey() === node.getKey();
        if (!inside) {
          const text = node.getFirstDescendant();
          if ($isTextNode(text)) text.select(0, 0);
        }
      });
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    });
  };

  return (
    <ContextMenu.Root>
      <PreserveSelectionOnRightClick />
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={styles.content}>
          <ContextMenu.Item
            className={styles.item}
            disabled={!canCopy}
            onSelect={() => {
              run(() => {
                editor.dispatchCommand(CUT_COMMAND, null);
              });
            }}
          >
            <span className={styles.label}>Cut</span>
            <span className={styles.shortcut}>{keys("X")}</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={styles.item}
            disabled={!canCopy}
            onSelect={() => {
              run(() => {
                editor.dispatchCommand(COPY_COMMAND, null);
              });
            }}
          >
            <span className={styles.label}>Copy</span>
            <span className={styles.shortcut}>{keys("C")}</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={styles.item}
            onSelect={() => {
              editor.focus(() => {
                void navigator.clipboard.readText().then(
                  (text) => {
                    insertPlainText(editor, text);
                  },
                  () => {
                    /* clipboard permission denied */
                  },
                );
              });
            }}
          >
            <span className={styles.label}>Paste</span>
            <span className={styles.shortcut}>{keys("V")}</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className={styles.separator} />
          <MenuCheck
            label="Bold"
            icon={styleIcon(Bold)}
            shortcut={keys("B")}
            checked={bold}
            disabled={!canFormat}
            onSelect={() => format("bold")}
          />
          <MenuCheck
            label="Italic"
            icon={styleIcon(Italic)}
            shortcut={keys("I")}
            checked={italic}
            disabled={!canFormat}
            onSelect={() => format("italic")}
          />
          <MenuCheck
            label="Strikethrough"
            icon={styleIcon(Strikethrough)}
            shortcut={keys("X", true)}
            checked={strike}
            disabled={!canFormat}
            onSelect={() => format("strikethrough")}
          />
          <MenuCheck
            label="Underline"
            icon={styleIcon(Underline)}
            shortcut={keys("U")}
            checked={underline}
            disabled={!canFormat}
            onSelect={() => format("underline")}
          />
          <MenuCheck
            label="Code"
            icon={styleIcon(Code)}
            shortcut={keys("E")}
            checked={code}
            disabled={!canFormat}
            onSelect={() => format("code")}
          />
          <ContextMenu.Separator className={styles.separator} />
          {HEADING_TAGS.map((tag, index) => (
            <MenuCheck
              key={tag}
              label={`Heading ${index + 1}`}
              shortcut={keys(String(index + 1), false, true)}
              checked={heading === tag}
              disabled={!canFormat}
              onSelect={() => {
                run(() => toggleHeading(editor, tag));
              }}
            />
          ))}
          <ContextMenu.Separator className={styles.separator} />
          <MenuCheck
            label="Code block"
            icon={styleIcon(CodeBrackets)}
            shortcut={keys("E", true)}
            checked={codeBlock}
            disabled={!canFormat}
            onSelect={() => {
              run(() => toggleCodeBlock(editor));
            }}
          />
          <MenuCheck
            label="Quote"
            icon={styleIcon(Quote)}
            shortcut={keys("'")}
            checked={quote}
            disabled={!canFormat}
            onSelect={() => {
              run(() => toggleQuote(editor));
            }}
          />
          <MenuCheck
            label="Bullet list"
            icon={styleIcon(List)}
            shortcut={keys("8", true)}
            checked={bullet}
            disabled={!canFormat}
            onSelect={() => {
              run(() => toggleList(editor, "bullet"));
            }}
          />
          <MenuCheck
            label="Numbered list"
            icon={styleIcon(NumberedListLeft)}
            shortcut={keys("7", true)}
            checked={numbered}
            disabled={!canFormat}
            onSelect={() => {
              run(() => toggleList(editor, "number"));
            }}
          />
          <MenuCheck
            label="To-do list"
            icon={styleIcon(TaskList)}
            shortcut={keys("9", true)}
            checked={todo}
            disabled={!canFormat}
            onSelect={() => {
              run(() => toggleList(editor, "check"));
            }}
          />
          <ContextMenu.Separator className={styles.separator} />
          <MenuCheck
            label="Link"
            icon={styleIcon(Link)}
            shortcut={keys("K")}
            checked={linkUrl != null}
            disabled={!canFormat}
            onSelect={openLinkPrompt}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
      {caretLink && !linkPrompt
        ? createPortal(
            <LinkCaretEditor
              linkKey={caretLink.key}
              url={caretLink.url}
              top={caretLink.top}
              left={caretLink.left}
              inputRef={linkInputRef}
              fieldFocused={linkFieldFocused}
              skipCommit={skipLinkCommit}
              onCommit={commitCaretLink}
              onRemove={removeCaretLink}
            />,
            document.body,
          )
        : null}
      {linkPrompt
        ? createPortal(
            <LinkDialog
              initialUrl={linkPrompt.url}
              hadLink={linkPrompt.hadLink}
              onApply={applyLink}
              onRemove={removeLink}
              onClose={() => setLinkPrompt(null)}
            />,
            document.body,
          )
        : null}
    </ContextMenu.Root>
  );
}

function MenuCheck({
  label,
  icon,
  shortcut,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  shortcut: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.CheckboxItem
      className={styles.item}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onSelect={onSelect}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{label}</span>
      <span className={styles.shortcut}>{shortcut}</span>
    </ContextMenu.CheckboxItem>
  );
}

function LinkCaretEditor({
  linkKey,
  url,
  top,
  left,
  inputRef,
  fieldFocused,
  skipCommit,
  onCommit,
  onRemove,
}: {
  linkKey: string;
  url: string;
  top: number;
  left: number;
  inputRef: RefObject<HTMLInputElement | null>;
  fieldFocused: RefObject<boolean>;
  skipCommit: RefObject<boolean>;
  onCommit: (url: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(url);
  useEffect(() => {
    if (fieldFocused.current) return;
    setDraft(url);
  }, [fieldFocused, linkKey, url]);

  return (
    <div
      className={styles.linkCaret}
      style={{ top, left }}
      role="group"
      aria-label="Edit link"
      onMouseDown={(event) => {
        fieldFocused.current = true;
        event.stopPropagation();
      }}
    >
      <input
        ref={inputRef}
        className={styles.linkCaretInput}
        value={draft}
        placeholder="https:// or a path"
        aria-label="Link URL"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onFocus={() => {
          fieldFocused.current = true;
        }}
        onBlur={(event) => {
          fieldFocused.current = false;
          if (skipCommit.current) {
            skipCommit.current = false;
            return;
          }
          onCommit(event.currentTarget.value);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            skipCommit.current = true;
            setDraft(url);
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className={styles.linkCaretRemove}
        aria-label="Remove link"
        onMouseDown={(event) => {
          event.preventDefault();
          skipCommit.current = true;
        }}
        onClick={onRemove}
      >
        <Xmark width={16} height={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

function LinkDialog({
  initialUrl,
  hadLink,
  onApply,
  onRemove,
  onClose,
}: {
  initialUrl: string;
  hadLink: boolean;
  onApply: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  return (
    <div className={styles.linkLayer} onMouseDown={onClose}>
      <form
        className={styles.linkDialog}
        role="dialog"
        aria-label="Link"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onApply(url);
        }}
      >
        <input
          className={styles.linkInput}
          value={url}
          autoFocus
          placeholder="https:// or a path"
          aria-label="Link URL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button type="submit" className={styles.linkButton}>
          Apply
        </button>
        {hadLink ? (
          <button type="button" className={styles.linkButton} onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </form>
    </div>
  );
}
