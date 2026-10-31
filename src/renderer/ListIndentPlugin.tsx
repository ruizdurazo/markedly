import { $isCodeNode } from "@lexical/code";
import {
  $createListItemNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import {
  $copyNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { useEffect } from "react";

function listItemFromNode(node: LexicalNode): ListItemNode | null {
  if ($isListItemNode(node)) return node;
  const parent = $findMatchingParent(node, $isListItemNode);
  return $isListItemNode(parent) ? parent : null;
}

function isListWrapper(item: ListItemNode): boolean {
  const first = item.getFirstChild();
  return $isListNode(first) && item.getChildrenSize() === 1;
}

function inCode(selection: RangeSelection): boolean {
  const node = selection.anchor.getNode();
  return $isCodeNode(node) || $findMatchingParent(node, $isCodeNode) != null;
}

function freshNestedList(parentList: ListNode): ListNode {
  const nested = $copyNode(parentList);
  if (nested.getListType() === "number") nested.setStart(1);
  return nested;
}

function parentListOf(item: ListItemNode): ListNode | null {
  const parent = item.getParent();
  return $isListNode(parent) ? parent : null;
}

/** The wrapper list-item that holds this item's children, if it has any. */
function childWrapper(item: ListItemNode): ListItemNode | null {
  const next = item.getNextSibling();
  return $isListItemNode(next) && isListWrapper(next) ? next : null;
}

/**
 * The list item this one is nested under. Children live in a wrapper item
 * that follows their parent, rather than inside it.
 */
function logicalParent(item: ListItemNode): ListItemNode | null {
  const parentList = parentListOf(item);
  if (parentList == null) return null;
  const wrapper = parentList.getParent();
  if (!$isListItemNode(wrapper)) return null;
  const previous = wrapper.getPreviousSibling();
  return $isListItemNode(previous) && !isListWrapper(previous) ? previous : null;
}

/** Outermost list items in the selection, so a parent is not shifted apart from its children. */
function $selectedListItems(selection: RangeSelection): ListItemNode[] {
  if (inCode(selection)) return [];
  const items: ListItemNode[] = [];
  const seen = new Set<string>();
  for (const node of selection.getNodes()) {
    const item = listItemFromNode(node);
    if (item == null || isListWrapper(item) || seen.has(item.getKey())) continue;
    seen.add(item.getKey());
    items.push(item);
  }
  return items;
}

function itemsToShift(items: ListItemNode[], outdent: boolean): ListItemNode[] {
  const selected = new Set(items.map((item) => item.getKey()));
  return items.filter((item) => {
    const parent = logicalParent(item);
    if (parent != null && selected.has(parent.getKey())) {
      if (!outdent || parent.getIndent() > 0) return false;
    }
    return !outdent || item.getIndent() > 0;
  });
}

function $indentListItem(item: ListItemNode): void {
  if (!item.isAttached() || isListWrapper(item)) return;
  const parentList = parentListOf(item);
  if (parentList == null) return;
  const previous = item.getPreviousSibling();
  if (previous == null) return;
  const children = childWrapper(item);

  if ($isListItemNode(previous) && isListWrapper(previous)) {
    const inner = previous.getFirstChild();
    if (!$isListNode(inner)) return;
    inner.append(item);
    if (children != null) inner.append(children);
    return;
  }
  if (!$isListItemNode(previous)) return;

  const existing = childWrapper(previous);
  if (existing != null) {
    const inner = existing.getFirstChild();
    if ($isListNode(inner)) {
      inner.append(item);
      if (children != null) inner.append(children);
    }
    return;
  }

  const nestedList = freshNestedList(parentList);
  const nestedItem = $createListItemNode();
  nestedItem.append(nestedList);
  previous.insertAfter(nestedItem);
  nestedList.append(item);
  if (children?.isAttached()) nestedList.append(children);
}

function $outdentListItem(item: ListItemNode): void {
  if (!item.isAttached() || isListWrapper(item) || item.getIndent() === 0) return;
  const parentList = parentListOf(item);
  if (parentList == null) return;
  const wrapper = parentList.getParent();
  if (!$isListItemNode(wrapper)) return;

  const children = childWrapper(item);
  const following = (children ?? item).getNextSiblings();
  wrapper.insertAfter(item);
  let tail: ListItemNode = item;
  if (children != null) {
    item.insertAfter(children);
    tail = children;
  }
  if (following.length > 0) {
    const restList = freshNestedList(parentList);
    const restItem = $createListItemNode();
    restItem.append(restList);
    for (const sibling of following) restList.append(sibling);
    tail.insertAfter(restItem);
  }
  if (parentList.getChildrenSize() === 0) wrapper.remove();
}

export function $hasSelectedListItems(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return $selectedListItems(selection).length > 0;
}

export function $shiftSelectedListIndent(outdent: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const items = $selectedListItems(selection);
  if (items.length === 0) return false;
  const moving = itemsToShift(items, outdent);
  const ordered = outdent ? [...moving].reverse() : moving;
  for (const item of ordered) {
    if (!item.isAttached()) continue;
    if (outdent) $outdentListItem(item);
    else $indentListItem(item);
  }
  return true;
}

export function ListIndentPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return false;
        if (!$shiftSelectedListIndent(event.shiftKey)) return false;
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);
  return null;
}
