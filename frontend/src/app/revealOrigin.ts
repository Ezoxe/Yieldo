import type { RevealOrigin } from "./ThemeProvider";

interface AskedFrom {
  currentTarget: Element;
  clientX?: number;
  clientY?: number;
  /** A click's count: 0 when the keyboard pressed the control. */
  detail?: number;
}

/**
 * Where a theme change was asked for, for the circle it opens from
 * (ThemeProvider): the pointer when there is one, the control's centre when
 * the keyboard asked — a click made with a key, or a select's change, has no
 * position of its own.
 */
export function revealOrigin(event: AskedFrom): RevealOrigin {
  if (
    event.detail !== undefined &&
    event.detail > 0 &&
    event.clientX !== undefined &&
    event.clientY !== undefined
  ) {
    return { x: event.clientX, y: event.clientY };
  }
  const box = event.currentTarget.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
