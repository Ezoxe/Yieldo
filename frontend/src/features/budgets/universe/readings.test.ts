import { describe, expect, it } from "vitest";

import type { BudgetDetailPart, BudgetReading } from "../../../lib/types";
import { fuelDetail, transportDetail } from "./fixtures";
import { gaugeFor, levelFor, partReadings } from "./readings";

function reading(budget: number, spent: number): BudgetReading {
  return {
    budget_cents: budget,
    spent_cents: spent,
    remaining_cents: budget + spent,
    consumed_ratio: -spent / budget,
    projected_cents: null,
    status: -spent >= budget ? "over" : "ok",
  };
}

function part(overrides: Partial<BudgetDetailPart>): BudgetDetailPart {
  return {
    category_id: 1, name: "Carburant", slug: "transport-carburant", color: "#f4a261",
    spent_cents: -11800, count: 2, average_ticket_cents: -5900, average_cents: -10400,
    months_counted: 18, budget: null, ...overrides,
  };
}

describe("gaugeFor", () => {
  it("reads the share of the ceiling still unspent", () => {
    expect(gaugeFor(reading(35000, -26250))).toEqual({
      remainingCents: 8750, budgetCents: 35000, share: 0.25, status: "ok",
    });
  });

  it("clamps an overspent ceiling to an empty gauge", () => {
    expect(gaugeFor(reading(10000, -14000))?.share).toBe(0);
  });

  it("has no gauge without a ceiling", () => {
    expect(gaugeFor(null)).toBeNull();
  });
});

describe("levelFor", () => {
  it("uses the part's own ceiling first", () => {
    expect(levelFor(part({ budget: reading(15000, -11800) }))).toEqual({
      share: 3200 / 15000, basis: "budget", referenceCents: 15000,
    });
  });

  it("falls back on the part's monthly mean, said as such", () => {
    const level = levelFor(part({ spent_cents: -2600, average_cents: -10400 }));
    expect(level).toEqual({ share: 0.75, basis: "average", referenceCents: 10400 });
  });

  it("empties, never goes negative, past the mean", () => {
    expect(levelFor(part({ spent_cents: -20000, average_cents: -10400 }))?.share).toBe(0);
  });

  it("has no level without a ceiling or a mean", () => {
    expect(levelFor(part({ average_cents: null }))).toBeNull();
    expect(levelFor(part({ average_cents: 0 }))).toBeNull();
  });
});

describe("partReadings", () => {
  it("draws the family's mapped children, none in front, on a family page", () => {
    const readings = partReadings(transportDetail, { universe: "car", focus: null });
    expect(readings.map((entry) => entry.part)).toEqual(["fuel", "engine", "cage", "toll"]);
    expect(readings.every((entry) => !entry.focused && !entry.dimmed)).toBe(true);
    expect(readings.find((entry) => entry.part === "fuel")?.level?.basis).toBe("budget");
  });

  it("draws the siblings around a child, the child in front", () => {
    const readings = partReadings(fuelDetail, { universe: "car", focus: "fuel" });
    const fuel = readings.find((entry) => entry.part === "fuel");
    expect(fuel?.focused).toBe(true);
    expect(fuel?.dimmed).toBe(false);
    expect(readings.filter((entry) => entry.dimmed).map((entry) => entry.part)).toEqual(["engine", "cage", "toll"]);
  });

  it("draws a lone root part from the page's own figures", () => {
    const lone = {
      ...fuelDetail,
      category: { ...fuelDetail.category, name: "Essence", slug: "essence", parent: null },
      siblings: [],
    };
    const readings = partReadings(lone, { universe: "car", focus: "fuel" });
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ part: "fuel", categoryId: lone.category.id, focused: true });
  });

  it("keeps one reading per part, the page's own when two categories share it", () => {
    const withTwoFuels = {
      ...fuelDetail,
      siblings: [
        part({ category_id: 90, name: "Recharge électrique", slug: "recharge" }),
        ...fuelDetail.siblings,
      ],
    };
    const fuels = partReadings(withTwoFuels, { universe: "car", focus: "fuel" }).filter(
      (entry) => entry.part === "fuel",
    );
    expect(fuels).toHaveLength(1);
    expect(fuels[0].categoryId).toBe(fuelDetail.category.id);
  });

  it("draws the heavier of two categories sharing a part when neither is the page", () => {
    const home = {
      ...transportDetail,
      category: { id: 1, name: "Logement", slug: "logement", color: "#3b82f6", is_essential: true, parent: null },
      parts: [
        part({ category_id: 2, name: "Crédit immobilier", slug: "logement-credit", spent_cents: 0, average_cents: 0 }),
        part({ category_id: 3, name: "Loyer", slug: "logement-loyer", spent_cents: -92000, average_cents: -92000 }),
      ],
    };
    const doors = partReadings(home, { universe: "house", focus: null }).filter((entry) => entry.part === "door");
    expect(doors).toHaveLength(1);
    expect(doors[0].name).toBe("Loyer");
  });
});
