import { useEffect } from "react";

import { useReducedMotion } from "../motion/useReducedMotion";

/** Where the light is, in the halo's own box. Read by Bento.css. */
const X = "--yd-cell-x";
const Y = "--yd-cell-y";
const CELL = ".yd-bento__cell";
/** The element the light is painted on — `BentoCell` renders exactly one. */
const HALO = ":scope > .yd-bento__cell-halo";

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
 *
 * The coordinates are written on the HALO, not on the cell, and measured
 * against the halo's own box — it is bigger than the card on every side, so a
 * percentage taken from the card would put the light 90px off.
 */
export function useCardSpotlight(): void {
  const reduced = useReducedMotion();

  useEffect(() => {
    // Under reduced motion the cards keep their hover tint — Bento.css paints
    // it at the default position — and nothing follows the pointer.
    if (reduced) return;

    let frame = 0;
    let lit: HTMLElement | null = null;
    let pending: { halo: HTMLElement; x: number; y: number } | null = null;

    const clear = (halo: HTMLElement) => {
      halo.style.removeProperty(X);
      halo.style.removeProperty(Y);
    };

    const flush = () => {
      frame = 0;
      if (!pending) return;
      const { halo, x, y } = pending;
      if (lit && lit !== halo) clear(lit);
      halo.style.setProperty(X, `${x}%`);
      halo.style.setProperty(Y, `${y}%`);
      lit = halo;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;

      const target = event.target;
      const cell =
        target instanceof Element ? (target.closest(CELL) as HTMLElement | null) : null;
      const halo = cell?.querySelector<HTMLElement>(HALO) ?? null;

      if (!halo) {
        pending = null;
        if (lit) {
          clear(lit);
          lit = null;
        }
        return;
      }

      const rect = halo.getBoundingClientRect();
      // jsdom, and a cell mid-unmount, both measure zero. A division by it
      // would write `NaN%` into the style attribute.
      if (rect.width === 0 || rect.height === 0) return;

      pending = {
        halo,
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
