import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { CheckIcon, ChevronIcon, YieldoMark } from "../design/icons";
import { ENVIRONMENTS, type Environment } from "./navigation";
import "./EnvironmentSwitcher.css";

interface EnvironmentSwitcherProps {
  current: Environment;
  /** Closes the mobile drawer when a switch navigates. */
  onNavigate?: () => void;
}

/**
 * The top-left control that changes which half of the application you are in.
 *
 * It sits where the brand block sat, and it keeps the brand: « Yieldo » is
 * still the first thing read, with the environment named under it. Losing the
 * product name to a switcher would make the application feel like two
 * applications, which is the opposite of what the switcher is for.
 *
 * **A menu, not a toggle.** Two environments would fit a toggle today, and a
 * toggle is the wrong shape the moment there is a third; more importantly a
 * toggle cannot say what it is toggling TO. Each row carries the
 * environment's one-line tagline, so someone who has never opened
 * Investissement learns what is behind it before clicking rather than after.
 *
 * Accessibility is the ordinary menu-button contract: `aria-haspopup="menu"`,
 * `aria-expanded`, `role="menu"` with `role="menuitemradio"` rows, Escape to
 * dismiss, focus returned to the button. The current environment is marked
 * `aria-checked`, and a tick is drawn beside it — the state is never carried
 * by colour alone.
 */
export function EnvironmentSwitcher({ current, onNavigate }: EnvironmentSwitcherProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // A click anywhere else closes it. `mousedown` rather than `click` so the
    // menu is gone before the click lands on whatever is underneath.
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const choose = (environment: Environment) => {
    setOpen(false);
    onNavigate?.();
    // Always navigate, even to the environment already open: someone deep in
    // /invest/mandat who picks « Investissement » means "take me home", and a
    // no-op would read as a broken control.
    navigate(environment.home);
  };

  const CurrentIcon = current.icon;

  return (
    <div className="yd-env">
      <button
        ref={buttonRef}
        type="button"
        className="yd-env__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <YieldoMark />
        <span className="yd-env__labels">
          <span className="yd-env__brand">Yieldo</span>
          <span className="yd-env__current">
            <CurrentIcon />
            {current.label}
          </span>
        </span>
        <ChevronIcon className="yd-env__chevron" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Changer d'environnement"
          className="yd-env__menu"
        >
          {ENVIRONMENTS.map((environment) => {
            const Glyph = environment.icon;
            const active = environment.id === current.id;
            return (
              <button
                key={environment.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`yd-env__item${active ? " yd-env__item--active" : ""}`}
                onClick={() => choose(environment)}
              >
                <Glyph />
                <span className="yd-env__item-text">
                  <span className="yd-env__item-label">{environment.label}</span>
                  <span className="yd-env__item-tagline">{environment.tagline}</span>
                </span>
                {/* Never colour alone: the tick is the state, the tint is the
                    decoration. */}
                {active ? <CheckIcon className="yd-env__tick" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
