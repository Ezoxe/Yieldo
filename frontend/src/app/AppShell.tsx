import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { AISpotlightProvider } from "../design/ai/AISpotlight";
import { AtmosphericBackground } from "../design/atmosphere/AtmosphericBackground";
import { useCardSpotlight } from "../design/bento/useCardSpotlight";
import { Shibi } from "../design/shibi/Shibi";
import { useShibiVisible } from "../design/shibi/shibiPreference";
import { AssistantIcon, ImportIcon } from "../design/icons";
import { AssistantDrawer } from "../features/assistant/AssistantDrawer";
import { useProposalCount } from "../features/agent/useProposalCount";
import { useAlertCount } from "../features/alerts/useAlertCount";
import { LedgerModeBadge } from "../features/plan/LedgerModeBadge";
import { GlobalSearch } from "../features/search/GlobalSearch";
import { useLedgerMode } from "../features/plan/useLedgerMode";
import { BottomTabs } from "./BottomTabs";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher";
import { MoreSheet } from "./MoreSheet";
import { environmentFor, type Environment, type NavSection } from "./navigation";
import { useCompactTitle } from "./useCompactTitle";
import { UserMenu } from "./UserMenu";
import { useReducedMotion } from "../design/motion/useReducedMotion";
import "./AppShell.css";

/**
 * What a badge's number counts, per route. A proposal waits for a decision;
 * an alert is in force until its cause goes. The default is the proposals'
 * word, which is what the badge said before alerts had one.
 */
const BADGE_WORD: Record<string, string> = {
  "/propositions": "en attente",
  "/alertes": "en cours",
};

interface SidebarNavProps {
  className: string;
  /**
   * The environment whose sections this nav draws. Passed in rather than read
   * from the location here: the sidebar, the phone tabs and the « Plus » sheet
   * all draw from it, and two readings of the same URL is one reading too many.
   */
  environment: Environment;
  /** Unique per rendered nav, so Motion's `layoutId` never animates the
   *  indicator between two navs that happen to be mounted at once. */
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

function SidebarNav({ className, environment, indicatorId, animated, badges }: SidebarNavProps) {
  const sections: NavSection[] = environment.sections;
  return (
    <nav className={className} aria-label="Navigation principale">
      {/* Where the brand block was. It still says « Yieldo » first — see
          EnvironmentSwitcher on why the product name does not give way to the
          control that changes environment. */}
      <EnvironmentSwitcher current={environment} />

      {sections.map((section, index) => (
        <div className="yd-shell__nav-section" key={section.title ?? `section-${index}`}>
          {section.title ? (
            <p className="yd-shell__nav-heading" aria-hidden="true">
              {section.title}
            </p>
          ) : null}
          <ul>
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end}>
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
                      {/* The space is for the accessible name: without it the
                          link reads « Alertes2 en cours ». A flex container
                          does not draw it. */}
                      {(badges?.[item.to] ?? 0) > 0 ? " " : null}
                      {(badges?.[item.to] ?? 0) > 0 ? (
                        <span className="yd-shell__nav-badge">
                          {badges?.[item.to]} {BADGE_WORD[item.to] ?? "en attente"}
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
  // « Plus » on a phone or a tablet — every destination the tab bar has no
  // room for, in a sheet (see MoreSheet).
  const [moreOpen, setMoreOpen] = useState(false);
  // The assistant panel, reachable from every screen. Separate state from the
  // « Plus » sheet: the two are different surfaces.
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
  // Whether the mascot is drawn at all — Réglages → Apparence.
  const shibi = useShibiVisible();
  // One listener for every card on every screen — see useCardSpotlight.
  useCardSpotlight();
  const location = useLocation();
  const navId = useId();
  // Which half of the application the current URL belongs to. One reading,
  // passed to the sidebar, the phone tabs and the « Plus » sheet, so the three
  // can never disagree about where the reader is.
  const environment = environmentFor(location.pathname);
  // The screen's title in the phone header, once its own h1 has scrolled away.
  const compactTitle = useCompactTitle(location.pathname);

  // How many changes the AI is waiting on a decision for. Refetched on every
  // navigation rather than polled: a proposal appears when the household asks
  // for an analysis, which is an action they took on a screen this shell just
  // rendered — there is nothing to poll for in between.
  const pendingProposals = useProposalCount((state) => state.pending);
  const refreshProposals = useProposalCount((state) => state.refresh);
  // The alerts too: an import or a saved budget on any screen can raise or
  // clear one, and both are actions taken on a screen this shell rendered.
  const alertCount = useAlertCount((state) => state.count);
  const refreshAlerts = useAlertCount((state) => state.refresh);
  useEffect(() => {
    void refreshProposals();
    void refreshAlerts();
  }, [refreshProposals, refreshAlerts, location.pathname]);

  const badges = { "/propositions": pendingProposals, "/alertes": alertCount };

  return (
    <AISpotlightProvider>
    <div className="yd-shell">
      {/* A sibling of the content, never an ancestor: the content lifts itself
          above it with its own stacking context (see AppShell.css). */}
      <AtmosphericBackground />

      <SidebarNav
        className="yd-shell__sidebar yd-shell__sidebar--static"
        environment={environment}
        indicatorId={`${navId}-static`}
        animated={!reducedMotion}
        badges={badges}
      />

      {/* Focus must not wander behind the « Plus » sheet while it is open. The
          sheet itself is rendered into the body, outside this element. */}
      <div className="yd-shell__body" inert={moreOpen || undefined}>
        {/* The header carries the reader's name and the one control that DOES
            something. The name is a menu button: Réglages, the theme and the
            exit sit behind it. The theme SELECT used to sit here as a permanent
            slot and no longer does — a preference set a few times a year does
            not earn the most valuable strip of the page — but a row inside a
            menu that is closed eleven months out of twelve costs nothing. */}
        <header className="yd-shell__header">
          {/* The phone header's left slot: the screen's own title, while its h1
              is scrolled out of view (see useCompactTitle). Never on a wide
              screen, where the sidebar says where the reader is. Hidden from
              assistive technology — the h1 itself is the screen's name, and a
              second copy in a landmark would be read twice. */}
          <p
            className="yd-shell__title"
            data-visible={compactTitle ? "true" : "false"}
            aria-hidden="true"
          >
            {compactTitle}
          </p>
          <UserMenu userName={userName} />
          {/* The reading, when it is not the plain one. The three-way control
              that used to sit here is a choice made a few times a year and now
              lives in Réglages; what stays is the STATEMENT, and only when
              there is one to make. See LedgerModeBadge. */}
          <LedgerModeBadge />
          {/* One box for the whole application. It takes the slot the mode
              control had because this is what a header slot is for: something
              used to get somewhere, on every screen, several times a day. */}
          <GlobalSearch />
          {/* The one action every screen may lead to: a statement in hand
              should not need the sidebar's twenty entries to find its door.
              The sidebar keeps its own « Import » entry; this is a shortcut,
              and it says the same word so the two are one destination. */}
          <Link to="/import" className="yd-shell__import">
            <ImportIcon />
            <span className="yd-shell__import-label">Importer</span>
          </Link>
          {/* The shibi IS the assistant's face, so it takes the mark's place
              here rather than sitting beside it — two drawings of the same
              thing on one button would be one too many. With the mascot
              switched off in Réglages the button falls back to the glyph the
              sidebar uses for the same destination. The word "Assistant" is
              the accessible name either way; nothing is ever named by a
              picture alone. */}
          <button
            type="button"
            className={`yd-shell__assistant${shibi ? " yd-shell__assistant--shibi" : ""}`}
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen((open) => !open)}
          >
            {shibi ? <Shibi state={assistantOpen ? "designation" : "repos"} /> : <AssistantIcon />}
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
        {/* Inside the body, so it is inert with the rest of the content while
            the « Plus » sheet is open — a tab bar that stayed live under the
            scrim would let a thumb change screens behind it. */}
        <BottomTabs
          environment={environment}
          onMore={() => setMoreOpen(true)}
          moreOpen={moreOpen}
        />
      </div>

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        environment={environment}
        badges={badges}
      />

      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
    </AISpotlightProvider>
  );
}
