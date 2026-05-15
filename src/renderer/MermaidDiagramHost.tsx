import { motion, useReducedMotion } from "motion/react";
import { Expand, Xmark } from "iconoir-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./MermaidDiagramHost.module.scss";

export type MermaidDiagramHostProps = {
  layoutId: string;
  mermaidEl: HTMLDivElement;
};

/**
 * Inline Mermaid block with expand control. Uses one `motion.div` + `layout` so the same
 * DOM subtree (including the rendered SVG) is never destroyed when opening or closing.
 * Backdrop is portaled behind the fixed surface. See Motion layout animation docs:
 * https://motion.dev/docs/react-layout-animations
 */
export function MermaidDiagramHost({
  layoutId,
  mermaidEl,
}: MermaidDiagramHostProps) {
  const [open, setOpen] = useState(false);
  /** Pixels: in-flow spacer while expanded so the markdown column does not collapse. */
  const [flowReserveHeightPx, setFlowReserveHeightPx] = useState<number | null>(
    null,
  );
  const slotRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (slot && mermaidEl.parentElement !== slot) {
      slot.appendChild(mermaidEl);
    }
  }, [mermaidEl, open]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setFlowReserveHeightPx(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  const expand = useCallback(() => {
    const host = mermaidEl.closest<HTMLElement>(".mermaid-host");
    const surface = surfaceRef.current;
    const raw =
      host?.offsetHeight ??
      surface?.offsetHeight ??
      Math.round(host?.getBoundingClientRect().height ?? 0);
    setFlowReserveHeightPx(Math.max(32, Math.round(raw)));
    setOpen(true);
  }, [mermaidEl]);

  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0.2, duration: 0.45 };

  const reservePx =
    open && flowReserveHeightPx != null ? Math.max(32, flowReserveHeightPx) : 0;

  return (
    <div className={styles.chrome}>
      {open && reservePx > 0 ? (
        <div
          className={styles.flowPlaceholder}
          style={{ height: `${reservePx}px` }}
          aria-hidden
        />
      ) : null}

      <motion.div
        ref={surfaceRef}
        layoutId={layoutId}
        layout
        transition={{ layout: layoutTransition }}
        className={open ? styles.surfaceExpanded : styles.surfaceInline}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Expanded diagram" : undefined}
        tabIndex={open ? -1 : undefined}
        onClick={open ? (e) => e.stopPropagation() : undefined}
      >
        {open ? (
          <div className={styles.closeWrap}>
            <button
              type="button"
              className={styles.closeBtn}
              aria-label="Close"
              onClick={close}
            >
              <Xmark
                width={20}
                height={20}
                color="currentColor"
                strokeWidth={2}
              />
            </button>
          </div>
        ) : null}
        <div className={styles.scrollRegion}>
          <div ref={slotRef} className={styles.slot} />
        </div>
        {!open ? (
          <button
            type="button"
            className={styles.expandBtn}
            aria-label="Expand diagram"
            onClick={expand}
          >
            Expand
          </button>
        ) : null}
      </motion.div>

      {typeof document !== "undefined" && open
        ? createPortal(
            <button
              type="button"
              className={styles.backdrop}
              aria-label="Close diagram"
              onClick={close}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
