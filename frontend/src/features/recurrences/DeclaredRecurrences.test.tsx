import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeclaredRecurrence, RecurrenceCalendar } from "../../lib/types";
import { DeclaredRecurrences } from "./DeclaredRecurrences";

const rent: DeclaredRecurrence = {
  id: 1, label: "Loyer", amount_cents: -78_000, amount_is_variable: false,
  periodicity: "monthly", anchor_on: "2026-01-03", ends_on: null,
  category_id: null, account_id: null, active: true, notes: null,
};

const calendar: RecurrenceCalendar = {
  date_from: "2026-09-01", date_to: "2026-09-30", occurrences: [], schedules: [],
  annual_charges_cents: -936_000, annual_income_cents: 0,
  monthly_charges_cents: -78_000, monthly_income_cents: 0,
  late_count: 0, pointed_count: 0, notice: null,
};

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/recurrences/declared") return Promise.resolve(jsonResponse([rent]));
    if (url.pathname === "/api/recurrences/calendar") return Promise.resolve(jsonResponse(calendar));
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("DeclaredRecurrences — the row's actions", () => {
  /**
   * « Modifier Loyer · Supprimer Loyer », six times down the list, read as
   * six sentences. The button shows one word; the declaration's name lives
   * in the accessible name, so a screen reader still hears which row.
   */
  it("shows a short word and names the declaration in full for assistive technology", async () => {
    render(
      <MemoryRouter>
        <DeclaredRecurrences categories={[]} accounts={[]} />
      </MemoryRouter>,
    );
    const edit = await screen.findByRole("button", { name: "Modifier Loyer" });
    const remove = screen.getByRole("button", { name: "Supprimer Loyer" });

    expect(within(edit).getByText("Modifier")).toHaveAttribute("aria-hidden", "true");
    expect(within(remove).getByText("Supprimer")).toHaveAttribute("aria-hidden", "true");
    expect(edit.querySelector("svg")).not.toBeNull();
    expect(remove.querySelector("svg")).not.toBeNull();
  });
});
