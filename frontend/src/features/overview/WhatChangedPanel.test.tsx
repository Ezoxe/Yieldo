import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { agoSentence, daysSince, WhatChangedPanel } from "./WhatChangedPanel";

const NOW = new Date("2026-09-13T10:00:00Z");

const latest = {
  imported_at: "2026-09-01T11:12:00Z", filename: "boursorama-2026-08.csv", rows_imported: 40,
};

const report = {
  alerts: [
    { kind: "budget_overrun", severity: "critical", severity_label: "Critique",
      key: "budget-transport", title: "Budget dépassé : Transport", measured: "…",
      period: "…", clears_when: "…", amount_cents: -29_100, on: null },
  ],
  conditions: [], coverage: {}, settings: {},
};

function stub(overrides: { alerts?: unknown; imports?: unknown } = {}) {
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    if (path === "/alerts") {
      const value = overrides.alerts ?? report;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (path === "/imports/last") {
      const value = "imports" in overrides ? overrides.imports : latest;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    throw new Error(`unexpected path ${path}`);
  });
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <WhatChangedPanel now={NOW} />
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("daysSince / agoSentence", () => {
  it("counts whole days and says the short ones in words", () => {
    expect(daysSince("2026-09-13T08:00:00Z", NOW)).toBe(0);
    expect(daysSince("2026-09-12T08:00:00Z", NOW)).toBe(1);
    expect(daysSince("2026-08-21T08:00:00Z", NOW)).toBe(23);
    expect(agoSentence(0)).toBe("aujourd'hui");
    expect(agoSentence(1)).toBe("hier");
    expect(agoSentence(23)).toBe("il y a 23 jours");
  });
});

describe("WhatChangedPanel", () => {
  it("says how old the ledger is, from the latest import", async () => {
    stub();
    renderPanel();
    expect(
      await screen.findByText(/Dernier import il y a 11 jours — boursorama-2026-08.csv, 40 opérations/),
    ).toBeInTheDocument();
  });

  it("lists the alerts in force with their severity in words and a way to the screen", async () => {
    stub();
    renderPanel();
    const title = await screen.findByRole("link", { name: "Budget dépassé : Transport" });
    expect(title).toHaveAttribute("href", "/alertes");
    expect(screen.getByText("Critique")).toBeInTheDocument();
  });

  it("says when nothing is in force, rather than showing an empty row", async () => {
    stub({ alerts: { ...report, alerts: [] } });
    renderPanel();
    expect(await screen.findByText("Aucune alerte en cours sur vos relevés.")).toBeInTheDocument();
  });

  it("invites the first import when there is none", async () => {
    // A 204: the api wrapper resolves to undefined.
    stub({ imports: undefined });
    renderPanel();
    expect(await screen.findByText(/Aucun relevé importé pour l'instant/)).toBeInTheDocument();
  });

  // The two rows fail separately, and a failure is printed — never an
  // empty row that reads as « rien à signaler ».
  it("prints a failed measurement in its row and keeps the other", async () => {
    stub({ alerts: new Error("boom") });
    renderPanel();
    expect(await screen.findByText("Les alertes n'ont pas pu être mesurées.")).toBeInTheDocument();
    expect(await screen.findByText(/Dernier import il y a 11 jours/)).toBeInTheDocument();
  });
});
