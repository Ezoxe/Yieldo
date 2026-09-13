import { NavLink } from "react-router";

import {
  AssistantIcon,
  BudgetsIcon,
  MenuIcon,
  OverviewIcon,
  TransactionsIcon,
} from "../design/icons";
import "./BottomTabs.css";

interface BottomTabsProps {
  /** Opens the sidebar drawer — the same one the hamburger opens. */
  onMore: () => void;
  moreOpen: boolean;
}

/**
 * Five tabs at the bottom of a phone screen.
 *
 * The drawer holds twenty-two entries under five headings, which is a map,
 * not a place to tap between the four screens a household opens every day.
 * Those four get a thumb-reach tab each; « Plus » opens the drawer for the
 * other eighteen. The bar is only drawn where the sidebar is hidden (see
 * BottomTabs.css, same breakpoint as the shell's drawer), so on a desktop
 * nothing changes.
 *
 * The four destinations are a hand-picked subset of `navigation.ts`, not a
 * derivation from it: which screens are daily is a product judgement, and
 * the sidebar order (pinned by AppShell.test) is not the same judgement.
 */
export function BottomTabs({ onMore, moreOpen }: BottomTabsProps) {
  return (
    <nav className="yd-tabs" aria-label="Navigation rapide">
      {/* « Accueil » on the tab — the sidebar's « Vue d'ensemble » is too long
          for a fifth of a phone and was clipped to « Vue d'ensem… ». The
          accessible name keeps the sidebar's word, so the two are one place. */}
      <NavLink to="/" end className="yd-tabs__tab" aria-label="Vue d'ensemble">
        <OverviewIcon />
        <span>Accueil</span>
      </NavLink>
      <NavLink to="/transactions" className="yd-tabs__tab">
        <TransactionsIcon />
        <span>Transactions</span>
      </NavLink>
      <NavLink to="/budgets" className="yd-tabs__tab">
        <BudgetsIcon />
        <span>Budgets</span>
      </NavLink>
      <NavLink to="/assistant" className="yd-tabs__tab">
        <AssistantIcon />
        <span>Assistant</span>
      </NavLink>
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
