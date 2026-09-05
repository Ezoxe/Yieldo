import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useId, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

import { AISpotlightProvider } from "../design/ai/AISpotlight";
import { AtmosphericBackground } from "../design/atmosphere/AtmosphericBackground";
import {
  AlertsIcon,
  AnalysisIcon,
  AssistantIcon,
  BudgetsIcon,
  CashflowIcon,
  CategoriesIcon,
  ConnectionsIcon,
  DebtsIcon,
  ExportIcon,
  FeasibilityIcon,
  GoalsIcon,
  ImportIcon,
  MenuIcon,
  OverviewIcon,
  PlanIcon,
  PortfolioIcon,
  ProposalsIcon,
  ProjectionIcon,
  RecurrencesIcon,
  SettingsIcon,
  SimulatorsIcon,
  StreakIcon,
  TransactionsIcon,
  YieldoMark,
  type IconComponent,
} from "../design/icons";
import { AssistantDrawer } from "../features/assistant/AssistantDrawer";
import { useProposalCount } from "../features/agent/useProposalCount";
import { LedgerModeControl } from "../features/plan/LedgerModeControl";
import { useLedgerMode } from "../features/plan/useLedgerMode";
import { slideOver } from "../design/motion/variants";
import { useReducedMotion } from "../design/motion/useReducedMotion";
import "./AppShell.css";

interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  end?: boolean;
}

/**
 * The sidebar, in groups.
 *
 * Twenty flat entries is a wall nobody reads top to bottom; the same twenty
 * under five headings is a map. The GROUPS are the only thing added — the
 * order of the entries themselves is unchanged, and `AppShell.test.tsx` pins
 * that order as a list, because an entry silently dropped in a refactor is a
 * screen the operator can no longer reach.
 *
 * A section heading is a `<p>`, never a link: the nav's own accessible list is
 * exactly the twenty destinations.
 */
interface NavSection {
  /** null for the first group — a heading over a single entry is noise. */
  title: string | null;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [{ to: "/", label: "Vue d'ensemble", icon: OverviewIcon, end: true }],
  },
  {
    title: "Au quotidien",
    items: [
      { to: "/transactions", label: "Transactions", icon: TransactionsIcon },
      { to: "/budgets", label: "Budgets", icon: BudgetsIcon },
      { to: "/recurrences", label: "Récurrences", icon: RecurrencesIcon },
      { to: "/plan", label: "Plan prévisionnel", icon: PlanIcon },
      { to: "/tresorerie", label: "Trésorerie", icon: CashflowIcon },
      { to: "/analyse", label: "Analyse", icon: AnalysisIcon },
    ],
  },
  {
    title: "Objectifs",
    items: [
      { to: "/dettes", label: "Dettes", icon: DebtsIcon },
      { to: "/objectifs", label: "Objectifs", icon: GoalsIcon },
      { to: "/suivi", label: "Suivi", icon: StreakIcon },
      { to: "/alertes", label: "Alertes", icon: AlertsIcon },
    ],
  },
  {
    title: "Horizon",
    items: [
      { to: "/patrimoine", label: "Patrimoine", icon: PortfolioIcon },
      { to: "/projection", label: "Projection", icon: ProjectionIcon },
      { to: "/faisabilite", label: "Faisabilité", icon: FeasibilityIcon },
      { to: "/simulateurs", label: "Simulateurs", icon: SimulatorsIcon },
    ],
  },
  {
    title: "Outils",
    items: [
      { to: "/assistant", label: "Assistant", icon: AssistantIcon },
      { to: "/propositions", label: "Propositions", icon: ProposalsIcon },
      { to: "/export", label: "Export IA", icon: ExportIcon },
      { to: "/categories", label: "Catégories", icon: CategoriesIcon },
      { to: "/import", label: "Import", icon: ImportIcon },
      { to: "/reglages", label: "Réglages", icon: SettingsIcon, end: true },
      { to: "/reglages/connexions", label: "Connexions", icon: ConnectionsIcon },
    ],
  },
];

interface SidebarNavProps {
  id?: string;
  className: string;
  onNavigate?: () => void;
  /**
   * Unique per rendered nav. The static sidebar and the mobile drawer are both
   * mounted at once (the first is only hidden by a media query), and a shared
   * `layoutId` would make Motion animate the indicator BETWEEN the two navs.
   */
  indicatorId: string;
  /** No sliding indicator when motion is reduced — the pill is painted by CSS
   *  either way, so the active entry is never left unmarked. */
  animated: boolean;
  /**
   * A count to show beside an entry, keyed by its route. Only ever rendered
   * when it is above zero: a badge reading "0" is a decoration claiming to be
   * information. The number joins the link's accessible name rather than being
   * hidden from it — "Propositions, 3 en attente" is the whole point of it.
   */
  badges?: Record<string, number>;
}

function SidebarNav({
  id, className, onNavigate, indicatorId, animated, badges,
}: SidebarNavProps) {
  return (
    <nav id={id} className={className} aria-label="Navigation principale">
      <div className="yd-shell__brand">
        <YieldoMark />
        <span>Yieldo</span>
      </div>

      {NAV_SECTIONS.map((section, index) => (
        <div className="yd-shell__nav-section" key={section.title ?? `section-${index}`}>
          {section.title ? (
            <p className="yd-shell__nav-heading" aria-hidden="true">
              {section.title}
            </p>
          ) : null}
          <ul>
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} onClick={onNavigate}>
                  {({ isActive }) => (
                    <>
                      {/* The travelling indicator: one element, moved by Motion
                          from the entry that was active to the one that is. */}
                      {isActive && animated ? (
                        <motion.span
                          className="yd-shell__nav-indicator"
                          layoutId={indicatorId}
                          transition={{ type: "spring", stiffness: 520, damping: 42 }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <item.icon />
                      {/* The link's whole accessible name, and its whole text
                          content — the icon beside it is `aria-hidden`. */}
                      {item.label}
                      {(badges?.[item.to] ?? 0) > 0 ? (
                        <span className="yd-shell__nav-badge">
                          {badges?.[item.to]} en attente
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

interface AppShellProps {
  userName: string;
}

export function AppShell({ userName }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The assistant panel, reachable from every screen. Separate state from the
  // mobile nav drawer above: the two are different surfaces and can be open at
  // once without either closing the other.
  const [assistantOpen, setAssistantOpen] = useState(false);

  // The reading, fetched once for the whole session. Every screen below is
  // keyed on it, so switching mode refetches the screen rather than leaving
  // the previous mode's figures under the new mode's label.
  const ledgerMode = useLedgerMode((state) => state.mode);
  const hydrateLedgerMode = useLedgerMode((state) => state.hydrate);
  useEffect(() => {
    void hydrateLedgerMode();
  }, [hydrateLedgerMode]);

  const reducedMotion = useReducedMotion();
  const location = useLocation();
  const navId = useId();

  // How many changes the AI is waiting on a decision for. Refetched on every
  // navigation rather than polled: a proposal appears when the household asks
  // for an analysis, which is an action they took on a screen this shell just
  // rendered — there is nothing to poll for in between.
  const pendingProposals = useProposalCount((state) => state.pending);
  const refreshProposals = useProposalCount((state) => state.refresh);
  useEffect(() => {
    void refreshProposals();
  }, [refreshProposals, location.pathname]);

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
    <AISpotlightProvider>
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
        <MenuIcon />
        Menu
      </button>

      <SidebarNav
        className="yd-shell__sidebar yd-shell__sidebar--static"
        indicatorId={`${navId}-static`}
        animated={!reducedMotion}
        badges={{ "/propositions": pendingProposals }}
      />

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
                  indicatorId={`${navId}-drawer`}
                  animated={false}
                  badges={{ "/propositions": pendingProposals }}
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
                  indicatorId={`${navId}-drawer`}
                  animated
                  badges={{ "/propositions": pendingProposals }}
                />
              </motion.div>
            </Fragment>
          )
        ) : null}
      </AnimatePresence>

      {/* Focus must not wander behind the scrim while the drawer is open. */}
      <div className="yd-shell__body" inert={drawerOpen || undefined}>
        {/* The header carries the reader's name and the one control that DOES
            something. The theme select used to sit here and no longer does:
            it is a preference, set once and rarely again, and it already has a
            home in Réglages → Apparence beside the density and animation
            switches. A permanent slot in the header for a yearly decision was
            spending the most valuable strip of the page on the least frequent
            action. */}
        <header className="yd-shell__header">
          <span className="yd-shell__user">{userName}</span>
          {/* Which reading every figure below is in. It earns its place beside
              the assistant for the reason the theme select lost it: this is
              not a preference set once a year, it is a statement about what
              the numbers on screen mean, and it has to be visible wherever
              they are. */}
          <LedgerModeControl />
          <button
            type="button"
            className="yd-shell__assistant"
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen((open) => !open)}
          >
            <AssistantIcon />
            Assistant
          </button>
        </header>
        <main className="yd-shell__main">
          {/* The screen arrives rather than appearing: a short rise and fade,
              keyed on the path so it replays on every route change. No exit
              animation and no AnimatePresence — waiting for the old screen to
              leave before showing the new one would add latency to every
              navigation for the sake of a symmetry nobody asked for. */}
          {reducedMotion ? (
            // Keyed on the mode for the same reason the animated branch is:
            // changing the reading changes what every figure on the screen
            // means, and a screen that kept its old numbers would be showing
            // the previous mode's answer under the new mode's label.
            <Outlet key={ledgerMode} />
          ) : (
            <motion.div
              key={`${location.pathname}|${ledgerMode}`}
              className="yd-shell__route"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          )}
        </main>
      </div>

      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
    </AISpotlightProvider>
  );
}
