import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";

import { AtmosphericBackground } from "../design/atmosphere/AtmosphericBackground";
import { slideOver } from "../design/motion/variants";
import { useReducedMotion } from "../design/motion/useReducedMotion";
import { type ThemePreference } from "../design/theme";
import "./AppShell.css";
import { useTheme } from "./ThemeProvider";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Vue d'ensemble", end: true },
  { to: "/transactions", label: "Transactions" },
  { to: "/budgets", label: "Budgets" },
  { to: "/recurrences", label: "Récurrences" },
  { to: "/tresorerie", label: "Trésorerie" },
  { to: "/categories", label: "Catégories" },
  { to: "/import", label: "Import" },
  { to: "/reglages", label: "Réglages" },
];

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Système" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];

interface SidebarNavProps {
  id?: string;
  className: string;
  onNavigate?: () => void;
}

function SidebarNav({ id, className, onNavigate }: SidebarNavProps) {
  return (
    <nav id={id} className={className} aria-label="Navigation principale">
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} onClick={onNavigate}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface AppShellProps {
  userName: string;
}

export function AppShell({ userName }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { preference, setPreference } = useTheme();
  const reducedMotion = useReducedMotion();

  const closeDrawer = () => setDrawerOpen(false);

  // Escape is the standard way to dismiss a dialog-like overlay; without this,
  // keyboard users stuck behind the scrim have no way out but the mouse.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="yd-shell">
      {/* A sibling of the content, never an ancestor: the content lifts itself
          above it with its own stacking context (see AppShell.css). */}
      <AtmosphericBackground />

      <button
        type="button"
        className="yd-shell__menu-toggle"
        aria-expanded={drawerOpen}
        aria-controls="yd-sidebar-drawer"
        onClick={() => setDrawerOpen((open) => !open)}
      >
        Menu
      </button>

      <SidebarNav className="yd-shell__sidebar yd-shell__sidebar--static" />

      <AnimatePresence>
        {drawerOpen ? (
          reducedMotion ? (
            // `prefers-reduced-motion` (or the CSS media block in GlassCard.css)
            // can't reach Motion's JS-driven animations, so when motion is
            // reduced the drawer is rendered as plain elements instead of
            // motion.* components: it still opens and closes, just without
            // the slide/fade transition.
            <Fragment key="drawer-instant">
              <div className="yd-shell__scrim" onClick={closeDrawer} aria-hidden="true" />
              <div className="yd-shell__drawer-wrap">
                <SidebarNav
                  id="yd-sidebar-drawer"
                  className="yd-shell__sidebar yd-shell__sidebar--drawer"
                  onNavigate={closeDrawer}
                />
              </div>
            </Fragment>
          ) : (
            <Fragment key="drawer-animated">
              <motion.div
                className="yd-shell__scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeDrawer}
                aria-hidden="true"
              />
              <motion.div
                className="yd-shell__drawer-wrap"
                variants={slideOver}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <SidebarNav
                  id="yd-sidebar-drawer"
                  className="yd-shell__sidebar yd-shell__sidebar--drawer"
                  onNavigate={closeDrawer}
                />
              </motion.div>
            </Fragment>
          )
        ) : null}
      </AnimatePresence>

      {/* Focus must not wander behind the scrim while the drawer is open. */}
      <div className="yd-shell__body" inert={drawerOpen || undefined}>
        <header className="yd-shell__header">
          <span className="yd-shell__user">{userName}</span>
          <label className="yd-shell__theme-select">
            <span className="sr-only">Thème</span>
            <select
              value={preference}
              onChange={(event) => setPreference(event.target.value as ThemePreference)}
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </header>
        <main className="yd-shell__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
