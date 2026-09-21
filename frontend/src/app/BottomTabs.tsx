import { NavLink } from "react-router";

import {
  AssistantIcon,
  BrokersIcon,
  BudgetsIcon,
  ControlRoomIcon,
  DecisionsIcon,
  MandateIcon,
  MenuIcon,
  OverviewIcon,
  TransactionsIcon,
  type IconComponent,
} from "../design/icons";
import type { Environment, EnvironmentId } from "./navigation";
import "./BottomTabs.css";

interface BottomTabsProps {
  /** Which half of the application the reader is in. */
  environment: Environment;
  /** Opens the sidebar drawer — the same one the hamburger opens. */
  onMore: () => void;
  moreOpen: boolean;
}

interface Tab {
  to: string;
  /** What the tab says. A fifth of a phone is about nine characters. */
  short: string;
  /** The sidebar's own word, when the tab had to shorten it. */
  label?: string;
  icon: IconComponent;
  end?: boolean;
}

/**
 * The four daily destinations, per environment.
 *
 * A hand-picked subset of `navigation.ts`, not a derivation from it: which
 * screens are daily is a product judgement, and the sidebar order (pinned by
 * AppShell.test) is not the same judgement. Per environment because the four
 * screens someone opens every day in Investissement are not the four they open
 * in Finances, and a tab bar that did not change with the switcher would be
 * four taps to the wrong half.
 */
const TABS: Record<EnvironmentId, Tab[]> = {
  finances: [
    // « Accueil » on the tab — the sidebar's « Vue d'ensemble » is too long for
    // a fifth of a phone and was clipped to « Vue d'ensem… ». The accessible
    // name keeps the sidebar's word, so the two are one place.
    { to: "/", short: "Accueil", label: "Vue d'ensemble", icon: OverviewIcon, end: true },
    { to: "/transactions", short: "Transactions", icon: TransactionsIcon },
    { to: "/budgets", short: "Budgets", icon: BudgetsIcon },
    { to: "/assistant", short: "Assistant", icon: AssistantIcon },
  ],
  investissement: [
    { to: "/invest", short: "Contrôle", label: "Salle de contrôle",
      icon: ControlRoomIcon, end: true },
    { to: "/invest/decisions", short: "Décisions", icon: DecisionsIcon },
    { to: "/invest/mandat", short: "Mandat", icon: MandateIcon },
    { to: "/invest/courtiers", short: "Courtiers", icon: BrokersIcon },
  ],
};

/**
 * Five tabs at the bottom of a phone screen.
 *
 * The drawer holds the whole environment under its headings, which is a map,
 * not a place to tap between the four screens a household opens every day.
 * Those four get a thumb-reach tab each; « Plus » opens the drawer for the
 * rest. The bar is only drawn where the sidebar is hidden (see BottomTabs.css,
 * same breakpoint as the shell's drawer), so on a desktop nothing changes.
 */
export function BottomTabs({ environment, onMore, moreOpen }: BottomTabsProps) {
  return (
    <nav className="yd-tabs" aria-label="Navigation rapide">
      {TABS[environment.id].map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className="yd-tabs__tab"
          aria-label={tab.label}
        >
          <tab.icon />
          <span>{tab.short}</span>
        </NavLink>
      ))}
      <button
        type="button"
        className="yd-tabs__tab yd-tabs__tab--more"
        aria-expanded={moreOpen}
        aria-controls="yd-sidebar-drawer"
        onClick={onMore}
      >
        <MenuIcon />
        <span>Plus</span>
      </button>
    </nav>
  );
}
