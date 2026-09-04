import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { CloseIcon } from "./icons/set";
import { IconBadge } from "./icons/IconBadge";
import type { IconComponent } from "./icons/Icon";
import { useReducedMotion } from "./motion/useReducedMotion";
import { SIGNATURE_EASE } from "./motion/variants";
import "./Drawer.css";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The mark beside the title — the same one the list it came from uses. */
  icon?: IconComponent;
  /** A short qualifier under the title: an amount, a rhythm, a date. */
  subtitle?: ReactNode;
  children: ReactNode;
}

/**
 * A panel that slides in from the right, over the page.
 *
 * Where the detail of a list row goes. A list whose every row carries seven
 * lines of explanation is not a list; a list of one-line rows that open into
 * this is. The rows stay scannable, and nothing is deleted — it moves one
 * click away.
 *
 * Dismissed the three ways a person expects: the close button, Escape, and a
 * click on the scrim. Focus moves into the panel on open and returns to
 * whatever opened it on close, so a keyboard user is not dropped at the top of
 * the document.
 */
export function Drawer({ open, onClose, title, icon, subtitle, children }: DrawerProps) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  // Where focus was before the drawer took it. Restored on close — without
  // this, dismissing the panel drops a keyboard user back at the top of the
  // page rather than on the row they opened.
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  const body = (
    <>
      <div className="yd-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="yd-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <div className="yd-drawer__head">
          {icon ? <IconBadge icon={icon} /> : null}
          <div className="yd-drawer__heading">
            <h2 className="yd-drawer__title">{title}</h2>
            {subtitle ? <p className="yd-drawer__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="yd-drawer__close" onClick={onClose} aria-label="Fermer">
            <CloseIcon />
          </button>
        </div>
        <div className="yd-drawer__body">{children}</div>
      </div>
    </>
  );

  // Under reduced motion the panel is mounted and unmounted outright rather
  // than animated at zero duration: an exit animation that never runs would
  // leave the drawer on screen for ever.
  if (reduced) return open ? <div className="yd-drawer">{body}</div> : null;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="yd-drawer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="yd-drawer__scrim" onClick={onClose} aria-hidden="true" />
          <motion.div
            className="yd-drawer__panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            ref={panel}
            initial={{ x: 32 }}
            animate={{ x: 0 }}
            exit={{ x: 32 }}
            transition={{ duration: 0.28, ease: SIGNATURE_EASE }}
          >
            <div className="yd-drawer__head">
              {icon ? <IconBadge icon={icon} /> : null}
              <div className="yd-drawer__heading">
                <h2 className="yd-drawer__title">{title}</h2>
                {subtitle ? <p className="yd-drawer__subtitle">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                className="yd-drawer__close"
                onClick={onClose}
                aria-label="Fermer"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="yd-drawer__body">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
