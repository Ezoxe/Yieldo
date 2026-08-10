import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { slideOver } from "../design/motion/variants";
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

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="yd-shell">
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
          <>
            <motion.div
              key="scrim"
              className="yd-shell__scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDrawer}
              aria-hidden="true"
            />
            <motion.div
              key="drawer"
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
          </>
        ) : null}
      </AnimatePresence>

      <div className="yd-shell__body">
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
