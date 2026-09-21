import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENVIRONMENTS,
  FINANCES,
  INVESTISSEMENT,
  SCREENS,
  environmentFor,
  otherEnvironment,
} from "./navigation";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(path.join(here, "routes.tsx"), "utf8");

describe("les deux environnements", () => {
  it("resolves a finance path to Finances and an invest path to Investissement", () => {
    expect(environmentFor("/").id).toBe("finances");
    expect(environmentFor("/transactions").id).toBe("finances");
    expect(environmentFor("/reglages/connexions").id).toBe("finances");
    expect(environmentFor("/invest").id).toBe("investissement");
    expect(environmentFor("/invest/mandat").id).toBe("investissement");
    expect(environmentFor("/invest/connexions").id).toBe("investissement");
  });

  it("never mistakes a finance path that merely starts with the same letters", () => {
    // `/investissements` is not a route today; if one is ever added it must not
    // silently land in the other environment.
    expect(environmentFor("/investissements-du-foyer").id).toBe("finances");
  });

  it("falls back to Finances for a path it does not know", () => {
    expect(environmentFor("/une-page-qui-nexiste-pas").id).toBe("finances");
  });

  it("gives every screen the environment of the list it sits in", () => {
    for (const screen of SCREENS) {
      const expected = screen.to.startsWith("/invest") ? "investissement" : "finances";
      expect(screen.environment, screen.to).toBe(expected);
    }
  });

  it("lists every screen of both halves, so the header search can see across", () => {
    const routes = SCREENS.map((screen) => screen.to);
    expect(routes).toContain("/transactions");
    expect(routes).toContain("/invest/mandat");
    // No screen listed twice: two entries for one route is two places a reader
    // can be sent and one of them will drift.
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("keeps the environments' route prefixes disjoint", () => {
    const investRoutes = INVESTISSEMENT.sections.flatMap((section) =>
      section.items.map((item) => item.to),
    );
    const financeRoutes = FINANCES.sections.flatMap((section) =>
      section.items.map((item) => item.to),
    );
    expect(investRoutes.every((route) => route.startsWith("/invest"))).toBe(true);
    expect(financeRoutes.some((route) => route.startsWith("/invest"))).toBe(false);
  });

  it("toggles to the other half", () => {
    expect(otherEnvironment(FINANCES).id).toBe("investissement");
    expect(otherEnvironment(INVESTISSEMENT).id).toBe("finances");
  });

  it("gives every environment a home its own prefixes claim", () => {
    for (const environment of ENVIRONMENTS) {
      expect(environmentFor(environment.home).id).toBe(environment.id);
    }
  });

  /**
   * The one that catches the real failure mode: a sidebar entry whose route
   * was never registered is a link that renders the "page not found" shell,
   * and nothing else in this suite would notice.
   */
  it("registers a route for every entry in both sidebars", () => {
    for (const screen of SCREENS) {
      const routePath = screen.to === "/" ? "index" : screen.to.slice(1);
      const registered =
        routePath === "index"
          ? ROUTES.includes("index: true")
          : ROUTES.includes(`path: "${routePath}"`);
      expect(registered, `${screen.to} n'a pas de route déclarée`).toBe(true);
    }
  });
});
