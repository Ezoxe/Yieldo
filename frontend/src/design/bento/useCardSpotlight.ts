import { useEffect } from "react";

import { useReducedMotion } from "../motion/useReducedMotion";

/** Where the light is, on the card under the pointer. Read by Bento.css. */
const X = "--yd-cell-x";
const Y = "--yd-cell-y";
const CELL = ".yd-bento__cell";

/**
 * A soft light that follows the pointer across whichever card it is over.
 *
 * One listener on the document rather than one per card: a dashboard renders
 * a dozen cells, a `pointermove` handler on each of them is a dozen closures
 * competing for the same event, and cells mount and unmount as screens change.
 * The listener is passive and writes at most once per frame — the reads are
 * one `getBoundingClientRect` on the cell actually under the pointer.
 *
 * Only the position comes from here. Whether the light is ON is a `:hover`
 * rule in Bento.css, so the fade in and out is the browser's own transition
 * and this hook never has to animate anything.
 *
 * Mouse only. A touch screen has no hover: a spotlight left where the finger
 * last pressed is a smudge on the card, not a highlight.
 */
export function useCardSpotlight(): void {
  const reduced = useReducedMotion();

  useEffect(() => {
    // Under reduced motion the cards keep their hover tint — Bento.css paints
    // it at the default position — and nothing follows the pointer.
    if (reduced) return;

    let frame = 0;
    let lit: HTMLElement | null = null;
    let pending: { cell: HTMLElement; x: number; y: number } | null = null;

    const clear = (cell: HTMLElement) => {
      cell.style.removeProperty(X);
      cell.style.removeProperty(Y);
    };

    const flush = () => {
      frame = 0;
      if (!pending) return;
      const { cell, x, y } = pending;
      if (lit && lit !== cell) clear(lit);
      cell.style.setProperty(X, `${x}%`);
      cell.style.setProperty(Y, `${y}%`);
      lit = cell;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;

      const target = event.target;
      const cell =
        target instanceof Element ? (target.closest(CELL) as HTMLElement | null) : null;

      if (!cell) {
        pending = null;
        if (lit) {
          clear(lit);
          lit = null;
        }
        return;
      }

      const rect = cell.getBoundingClientRect();
      // jsdom, and a cell mid-unmount, both measure zero. A division by it
      // would write `NaN%` into the style attribute.
      if (rect.width === 0 || rect.height === 0) return;

      pending = {
        cell,
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
      if (frame === 0) frame = requestAnimationFrame(flush);
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      if (frame !== 0) cancelAnimationFrame(frame);
      if (lit) clear(lit);
    };
  }, [reduced]);
}
