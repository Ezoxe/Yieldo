import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "./icons/set";
import { useReducedMotion } from "./motion/useReducedMotion";
import "./Sheet.css";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name, printed as its heading. */
  title: string;
  /** A short qualifier under the title: a date, an amount, an account. */
  subtitle?: ReactNode;
  /** Before the title — an icon badge, an initial. Decoration. */
  leading?: ReactNode;
  /** Keep the name for assistive technology, drop the printed heading: for a
   *  sheet whose content opens with its own (the « Plus » grid). */
  hideTitle?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** How far down, or how fast, a drag has to go before it closes the sheet. */
const CLOSE_DISTANCE = 80;
const CLOSE_VELOCITY = 500;

/** No overshoot: the sheet follows the thumb, it does not bounce off it. */
const SHEET_SPRING = { type: "spring", stiffness: 420, damping: 40 } as const;

/**
 * A panel that rises from the bottom of a phone.
 *
 * Where a phone puts what a desktop puts in a side drawer or a menu: the
 * « Plus » destinations, an operation's actions, a detail. It is within thumb
 * reach, it leaves the top of the screen in view, and it closes the four ways
 * a phone reader expects — a swipe down on its head, a tap on the scrim, the
 * close button, Escape.
 *
 * Rendered into `document.body`: a `position: fixed` element inside a
 * transformed ancestor (the route wrapper animates with `transform`) would be
 * positioned against that ancestor instead of the screen.
 *
 * Focus moves into the panel on open and back to whatever opened it on close.
 * The page under it does not scroll while it is open. The swipe starts from the
 * head only, so a long list inside the body scrolls instead of dragging the
 * whole sheet.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  leading,
  hideTitle = false,
  id,
  className = "",
  children,
}: SheetProps) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const headingId = useId();
  const drag = useDragControls();

  // The latest onClose, without making it an effect dependency: a caller that
  // passes an inline arrow would otherwise re-run the effect on every render,
  // and each run would move the focus back to the panel.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  const head = (
    <div
      className="yd-sheet__head"
      onPointerDown={reduced ? undefined : (event: PointerEvent) => drag.start(event)}
    >
      <span className="yd-sheet__handle" aria-hidden="true" />
      <div className="yd-sheet__titles">
        {leading}
        <div className="yd-sheet__heading">
          <h2 id={headingId} className={hideTitle ? "sr-only" : "yd-sheet__title"}>
            {title}
          </h2>
          {subtitle ? <p className="yd-sheet__subtitle">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="yd-sheet__close"
          aria-label="Fermer"
          onClick={() => close.current()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );

  const body = <div className="yd-sheet__body">{children}</div>;
  const dialogProps = {
    className: "yd-sheet__panel",
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": headingId,
    tabIndex: -1,
    ref: panel,
  } as const;

  // Under reduced motion the sheet is mounted and unmounted outright rather
  // than animated at zero duration: an exit that never runs would leave it on
  // screen for ever.
  if (reduced) {
    return open
      ? createPortal(
          <div className={`yd-sheet ${className}`.trim()} id={id}>
            <div className="yd-sheet__scrim" onClick={() => close.current()} aria-hidden="true" />
            <div {...dialogProps}>
              {head}
              {body}
            </div>
          </div>,
          document.body,
        )
      : null;
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > CLOSE_DISTANCE || info.velocity.y > CLOSE_VELOCITY) close.current();
  };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="sheet"
          className={`yd-sheet ${className}`.trim()}
          id={id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.2 }}
        >
          <div className="yd-sheet__scrim" onClick={() => close.current()} aria-hidden="true" />
          <motion.div
            {...dialogProps}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={SHEET_SPRING}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={onDragEnd}
          >
            {head}
            {body}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
