import { describe, expect, it } from "vitest";

import {
  AI_TARGETS,
  categoryTarget,
  categoryTargetId,
  normalise,
  targetsMentionedIn,
} from "./targets";

describe("normalise", () => {
  it("strips accents and case, so both sides of a match are in one form", () => {
    expect(normalise("Trésorerie")).toBe("tresorerie");
    expect(normalise("RÉGULARITÉ")).toBe("regularite");
  });
});

describe("categoryTargetId", () => {
  // Both sides derive the id from the NAME: the chip is built from
  // GET /categories, the row from GET /budgets, and the second carries no slug
  // at all. A shared derivation cannot drift.
  it("is the same id from either side, whatever the name looks like", () => {
    expect(categoryTargetId("Courses")).toBe("budget-courses");
    expect(categoryTargetId("Énergie")).toBe("budget-energie");
    expect(categoryTargetId("Loisirs & sorties")).toBe("budget-loisirs-sorties");
  });
});

describe("targetsMentionedIn", () => {
  it("finds a target named in the answer", () => {
    const found = targetsMentionedIn("Ta jauge d'autonomie est à 0,8 mois.");
    expect(found.map((target) => target.id)).toContain("kpi-autonomie");
  });

  // The whole point of the word boundary. "dette" inside "détecté" normalises
  // to "detecte" — but "budget" inside "budgetaire" would fire on a substring
  // match, and the chip would point at a screen the sentence never mentioned.
  it("never fires on a word that merely contains a term", () => {
    expect(targetsMentionedIn("Une ligne budgetaire imaginaire.").map((t) => t.id)).not.toContain(
      "panel-budgets",
    );
    expect(targetsMentionedIn("Rien n'a été détecté.").map((t) => t.id)).not.toContain(
      "panel-dettes",
    );
  });

  it("matches whatever the accents, on both sides", () => {
    expect(targetsMentionedIn("Le flux de trésorerie du mois.").map((t) => t.id)).toContain(
      "chart-flux",
    );
  });

  it("orders targets by where they are first named", () => {
    const found = targetsMentionedIn("Tes abonnements pèsent sur ton solde net.");
    expect(found.map((target) => target.id)).toEqual(["panel-recurrences", "kpi-solde-net"]);
  });

  it("offers one chip per target however often it is named", () => {
    const found = targetsMentionedIn("Budget, budget, et encore budget.");
    expect(found.filter((target) => target.id === "panel-budgets")).toHaveLength(1);
  });

  it("finds a category the account actually has, named in the answer", () => {
    const found = targetsMentionedIn("Ton budget Courses a explosé ce mois-ci.", [
      categoryTarget("Courses"),
    ]);
    expect(found.map((target) => target.id)).toContain("budget-courses");
  });

  // An account whose category is called "Abonnements" put two chips reading
  // "Abonnements" side by side — one for the budget row, one for the
  // recurrences screen — with nothing saying which was which.
  it("tells a category chip apart from the screen that shares its name", () => {
    const found = targetsMentionedIn("Tes abonnements coûtent cher.", [
      categoryTarget("Abonnements"),
    ]);
    const labels = found.map((target) => target.label);
    expect(labels).toContain("Budget Abonnements");
    expect(labels).toContain("Abonnements");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("says nothing about a sentence that names nothing on screen", () => {
    expect(targetsMentionedIn("Bonjour.")).toEqual([]);
  });
});

describe("the target list itself", () => {
  it("has no two entries sharing an id", () => {
    const ids = AI_TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A chip navigates to `route` when the element is not on this screen; an
  // entry pointing at a route that does not exist would send the reader
  // nowhere.
  it("gives every entry a route and at least one term", () => {
    for (const target of AI_TARGETS) {
      expect(target.route.startsWith("/"), target.id).toBe(true);
      expect(target.terms.length, target.id).toBeGreaterThan(0);
      // Terms are matched against normalised text, so they must be normalised
      // themselves or they can never match anything.
      for (const term of target.terms) expect(normalise(term), target.id).toBe(term);
    }
  });
});
