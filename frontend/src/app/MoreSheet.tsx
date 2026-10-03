import { Link, NavLink } from "react-router";

import { ImportIcon } from "../design/icons";
import { Sheet } from "../design/Sheet";
import { ENVIRONMENTS, type Environment, type NavItem, type NavSection } from "./navigation";
import "./MoreSheet.css";

/**
 * The sidebar's sections, with a heading-less group folded into the section
 * after it. The sidebar gives « Vue d'ensemble » a group of its own because a
 * heading over one entry is noise there; in a grid of tiles the same group is
 * a whole row holding one tile, and that row is what pushed the sheet past the
 * bottom of the screen.
 */
function sheetSections(sections: NavSection[]): NavSection[] {
  const merged: NavSection[] = [];
  let carried: NavItem[] = [];
  for (const section of sections) {
    if (section.title === null) {
      carried = [...carried, ...section.items];
      continue;
    }
    merged.push({ title: section.title, items: [...carried, ...section.items] });
    carried = [];
  }
  if (carried.length > 0) merged.push({ title: null, items: carried });
  return merged;
}

/** What a count beside an entry counts — the sidebar's own words. */
const BADGE_WORD: Record<string, string> = {
  "/propositions": "en attente",
  "/alertes": "en cours",
};

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** The half of the application the reader is in: its destinations fill the
   *  grid. */
  environment: Environment;
  /** Counts beside entries, keyed by route — the sidebar's badges. */
  badges?: Record<string, number>;
}

/**
 * « Plus », on a phone or a tablet: every destination the tab bar has no room
 * for.
 *
 * It replaces the desktop sidebar opened as a left drawer, which was 1 168px
 * of list for 21 entries on an 844px screen — Réglages was below the fold of
 * the menu itself. Here every destination is a tile under its section's
 * heading, four to a row, and the whole map fits in one screen within thumb
 * reach. Above it, the two things a phone reader comes to this sheet for that
 * are not a screen of their own: switching between Finances and
 * Investissement, and importing a statement — the header's import button has
 * no room on a phone.
 *
 * The list is `environment.sections`, the sidebar's own: one list, so a screen
 * cannot be reachable from one and missing from the other.
 */
export function MoreSheet({ open, onClose, environment, badges = {} }: MoreSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Plus" hideTitle id="yd-more-sheet" className="yd-more">
      <div className="yd-more__envs" role="group" aria-label="Environnement">
        {ENVIRONMENTS.map((candidate) => (
          <Link
            key={candidate.id}
            to={candidate.home}
            className="yd-more__env"
            aria-current={candidate.id === environment.id ? "true" : undefined}
            onClick={onClose}
          >
            <candidate.icon />
            {candidate.label}
          </Link>
        ))}
      </div>

      {environment.id === "finances" ? (
        <Link to="/import" className="yd-more__import" onClick={onClose}>
          <ImportIcon />
          Importer un relevé
        </Link>
      ) : null}

      {sheetSections(environment.sections).map((section, index) => (
        <section
          key={section.title ?? `section-${index}`}
          className="yd-more__section"
          aria-labelledby={section.title ? `yd-more-${index}` : undefined}
        >
          {section.title ? (
            <h3 className="yd-more__heading" id={`yd-more-${index}`}>
              {section.title}
            </h3>
          ) : null}
          <ul className="yd-more__grid">
            {section.items.map((item) => {
              const count = badges[item.to] ?? 0;
              return (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className="yd-more__tile" onClick={onClose}>
                    <item.icon />
                    <span className="yd-more__label">{item.label}</span>
                    {count > 0 ? (
                      <>
                        <span className="yd-more__badge" aria-hidden="true">
                          {count}
                        </span>
                        <span className="sr-only">
                          , {count} {BADGE_WORD[item.to] ?? "en attente"}
                        </span>
                      </>
                    ) : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
