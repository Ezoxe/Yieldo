import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { AccountIcon, SettingsIcon, SignOutIcon, ThemeIcon } from "../design/icons";
import { useSession } from "../features/auth/session";
import { useTheme } from "./ThemeProvider";
import "./UserMenu.css";

interface UserMenuProps {
  userName: string;
}

/**
 * The reader's name in the header used to be dead text, and « Se
 * déconnecter » lived at the very bottom of Réglages, four viewports down.
 * The name is now a button, and the menu behind it holds the three things a
 * header slot is for: the way to Réglages, the theme (a choice made a few
 * times a year, so a menu row rather than a permanent select), and the exit.
 *
 * Plain WAI-ARIA menu button: `aria-haspopup="menu"`, arrow keys walk the
 * items, Escape closes and returns focus to the trigger, a click outside
 * closes. No library — the codebase has none for this and one menu does not
 * earn one.
 */
export function UserMenu({ userName }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const navigate = useNavigate();
  const logout = useSession((state) => state.logout);
  const { preference, setPreference } = useTheme();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Focus the first item once the menu is in the document, so a keyboard
  // reader lands inside it rather than on the trigger with a menu open below.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>("[role^='menuitem']");
    first?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  async function signOut() {
    close(false);
    await logout();
    navigate("/connexion", { replace: true });
  }

  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="yd-user-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="yd-user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${userName} — menu du compte`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="yd-user-menu__initial" aria-hidden="true">
          {initial}
        </span>
        <span className="yd-user-menu__name" aria-hidden="true">
          {userName}
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Menu du compte"
          className="yd-user-menu__panel"
          onKeyDown={onMenuKeyDown}
        >
          <p className="yd-user-menu__who" aria-hidden="true">
            <AccountIcon />
            {userName}
          </p>

          <button
            type="button"
            role="menuitem"
            className="yd-user-menu__item"
            onClick={() => {
              close(false);
              navigate("/reglages");
            }}
          >
            <SettingsIcon />
            Réglages
          </button>

          <div className="yd-user-menu__group" role="group" aria-label="Thème">
            <p className="yd-user-menu__group-title" aria-hidden="true">
              <ThemeIcon />
              Thème
            </p>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={preference === option.value}
                className="yd-user-menu__item yd-user-menu__item--radio"
                onClick={() => setPreference(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            role="menuitem"
            className="yd-user-menu__item yd-user-menu__item--exit"
            onClick={() => void signOut()}
          >
            <SignOutIcon />
            Se déconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}

const THEME_OPTIONS: { value: "system" | "light" | "dark"; label: string }[] = [
  { value: "system", label: "Système" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];
