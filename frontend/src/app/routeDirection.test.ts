import { describe, expect, it } from "vitest";

import { routeDirection } from "./routeDirection";

describe("routeDirection", () => {
  it("goes deeper into a screen of the same family", () => {
    expect(routeDirection("/budgets", "/budgets/12")).toBe(1);
    expect(routeDirection("/reglages", "/reglages/connexions")).toBe(1);
    expect(routeDirection("/invest", "/invest/mandat")).toBe(1);
  });

  it("comes back up the same way", () => {
    expect(routeDirection("/budgets/12", "/budgets")).toBe(-1);
    expect(routeDirection("/reglages/connexions", "/reglages")).toBe(-1);
  });

  it("moves sideways between two screens of the sidebar", () => {
    expect(routeDirection("/budgets", "/avenir")).toBe(0);
    expect(routeDirection("/", "/transactions")).toBe(0);
    expect(routeDirection("/budgets/12", "/budgets/14")).toBe(0);
    expect(routeDirection("/invest/mandat", "/invest/courtiers")).toBe(0);
  });

  it("ignores a query string and a trailing slash", () => {
    expect(routeDirection("/budgets?mois=2026-09", "/budgets/12?mois=2026-09")).toBe(1);
    expect(routeDirection("/budgets/", "/budgets")).toBe(0);
  });
});
