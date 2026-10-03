import { useLayoutEffect, useRef, type RefObject } from "react";

import { useReducedMotion } from "./useReducedMotion";

const SIGNATURE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * A list whose rows glide to their new place instead of jumping there.
 *
 * Every element inside `container` carrying `data-flip-key` is measured after
 * each change of `signature` (the list's keys, joined). A row that was there
 * before slides from where it stood to where it stands now, in 320ms; a row
 * that was not there arrives with a 6px rise, 25ms after the one before it,
 * eight at most — « Charger plus » or a cleared search does not become a
 * cascade of two hundred. Positions are taken against the container, so a
 * page scrolled between two renders moves nothing.
 *
 * The rows the list first appears with are left to the screen's own entry.
 * Rows that leave simply go: the ones that stay close the gap by gliding.
 * Motion off: nothing moves. Driven by the Web Animations API, so a table row
 * keeps being a table row — no wrapper, no Motion component per row.
 */
export function useFlipList(container: RefObject<HTMLElement | null>, signature: string): void {
  const reduced = useReducedMotion();
  const previous = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const origin = root.getBoundingClientRect().top;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-flip-key]"));
    const positions = new Map<string, number>();
    for (const node of nodes) {
      positions.set(node.dataset.flipKey ?? "", node.getBoundingClientRect().top - origin);
    }

    const before = previous.current;
    previous.current = positions;
    if (before === null || reduced) return;

    let arriving = 0;
    for (const node of nodes) {
      const key = node.dataset.flipKey ?? "";
      const now = positions.get(key) ?? 0;
      const then = before.get(key);
      if (then === undefined) {
        node.animate?.(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 280, easing: SIGNATURE, delay: Math.min(arriving, 8) * 25, fill: "backwards" },
        );
        arriving += 1;
      } else if (Math.abs(then - now) > 0.5) {
        node.animate?.(
          [{ transform: `translateY(${then - now}px)` }, { transform: "none" }],
          { duration: 320, easing: SIGNATURE },
        );
      }
    }
    // `signature` is what changes when the rows do; `container` is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reduced]);
}
