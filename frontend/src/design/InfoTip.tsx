import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { InfoIcon } from "./icons/set";
import "./InfoTip.css";

interface InfoTipProps {
  /**
   * What the mark stands for, for anyone who cannot see it — "Comment ce
   * chiffre est mesuré", not "Info". It is the button's accessible name.
   */
  label: string;
  /** The explanation itself. Prose, in French, as long as it needs to be. */
  children: ReactNode;
  className?: string;
}

/**
 * A methodology note, folded away behind a mark.
 *
 * This screen's engines explain themselves at length, and they are right to —
 * but four sentences of method under every figure buries the figure. The
 * sentence still ships, in full, one interaction away: hover, focus, or click
 * the mark.
 *
 * It is a real `<button>`, opened by click as well as by hover, because a
 * hover-only disclosure is unreachable on a touch screen. The panel is wired
 * with `aria-describedby` while it is open, so a screen reader reads the
 * explanation as a description of the control rather than as loose text.
 */
export function InfoTip({ label, children, className = "" }: InfoTipProps) {
  // Two independent reasons to be open, not one.
  //
  // A single `open` boolean toggled by BOTH hover and click cancels itself: a
  // real click is preceded by a pointerenter, so the hover opens the panel and
  // the click that follows closes it again. Pointer presence and a deliberate
  // pin are different facts, and the panel shows while either holds.
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);

  // Escape closes, and so does a click anywhere else — the two ways out a
  // reader expects from anything that pops over the page.
  useEffect(() => {
    if (!pinned) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pinned]);

  return (
    <span
      className={`yd-infotip ${className}`.trim()}
      ref={root}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="yd-infotip__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setPinned((value) => !value)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <InfoIcon />
      </button>
      {open ? (
        <span role="tooltip" id={panelId} className="yd-infotip__panel">
          {children}
        </span>
      ) : null}
    </span>
  );
}
