import { addClassNamesToElement } from "@lexical/utils";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
} from "lexical";

export type SerializedMathBlockNode = SerializedElementNode;

/** Display math kept as source (`\\[ ... \\]` or `$$ ... $$`) so export does not escape it. */
export class MathBlockNode extends ElementNode {
  static getType(): string {
    return "math";
  }

  static clone(node: MathBlockNode): MathBlockNode {
    return new MathBlockNode(node.getKey());
  }

  static importJSON(serializedNode: SerializedMathBlockNode): MathBlockNode {
    return $createMathBlockNode().updateFromJSON(serializedNode);
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.spellcheck = false;
    addClassNamesToElement(element, "md-math");
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedMathBlockNode {
    return {
      ...super.exportJSON(),
      type: "math",
      version: 1,
    };
  }

  insertNewAfter(
    selection: RangeSelection,
    restoreSelection = true,
  ): LexicalNode {
    const paragraph = $createParagraphNode();
    paragraph.setTextFormat(selection.format);
    paragraph.setTextStyle(selection.style);
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }

  collapseAtStart(_selection: RangeSelection): boolean {
    const paragraph = $createParagraphNode();
    for (const child of this.getChildren()) paragraph.append(child);
    this.replace(paragraph);
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }
}

export function $createMathBlockNode(): MathBlockNode {
  return $applyNodeReplacement(new MathBlockNode());
}

export function $isMathBlockNode(
  node: LexicalNode | null | undefined,
): node is MathBlockNode {
  return node instanceof MathBlockNode;
}
