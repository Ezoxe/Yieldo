import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Occurrence } from "../../lib/types";
import { RecurrenceCalendar, isoDay, mondayIndex, monthGrid } from "./RecurrenceCalendar";

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    schedule_id: 1,
    label: "Netflix",
    due_on: "2026-09-18",
    amount_cents: -1_599,
    status: "upcoming",
    paid_on: null,
    transaction_id: null,
    ...overrides,
  };
}

describe("monthGrid", () => {
  // 1 September 2026 is a Tuesday. A Sunday-based index would put it in the
  // first column of a French calendar, one day early, all month.
  it("starts the month in the column its first day really falls in", () => {
    const weeks = monthGrid(2026, 9);
    expect(weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6]);
  });

  it("pads the last week so every row holds seven cells", () => {
    for (const week of monthGrid(2026, 9)) {
      expect(week).toHaveLength(7);
    }
  });

  it("knows how long February is, leap year included", () => {
    expect(monthGrid(2025, 2).flat().filter((d) => d !== null)).toHaveLength(28);
    expect(monthGrid(2024, 2).flat().filter((d) => d !== null)).toHaveLength(29);
  });

  it("counts Monday as the first column", () => {
    // 2026-09-07 is a Monday.
    expect(mondayIndex(new Date(Date.UTC(2026, 8, 7)))).toBe(0);
    // 2026-09-13 is a Sunday: last, not first.
    expect(mondayIndex(new Date(Date.UTC(2026, 8, 13)))).toBe(6);
  });

  it("writes a day as the API writes it", () => {
    expect(isoDay(2026, 9, 8)).toBe("2026-09-08");
  });
});

describe("RecurrenceCalendar", () => {
  it("puts a due date on its own day", () => {
    render(<RecurrenceCalendar year={2026} month={9} occurrences={[occurrence()]}
                               onToggle={vi.fn()} pending={null} />);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("−15,99 €")).toBeInTheDocument();
  });

  /**
   * The button's own text is three words in a 90px box. The reader who needs
   * the rest is the one who cannot see the grid, so the whole sentence -- what,
   * how much, when, and what a click would do -- lives in the accessible name.
   */
  it("names what a click would do, on which charge, in one sentence", () => {
    render(<RecurrenceCalendar year={2026} month={9} occurrences={[occurrence()]}
                               onToggle={vi.fn()} pending={null} />);
    expect(
      screen.getByRole("button", { name: /Netflix.*échéance du 18.*À venir.*pointer/ }),
    ).toBeInTheDocument();
  });

  it("reports a click with the occurrence it was on", async () => {
    const onToggle = vi.fn();
    const row = occurrence();
    render(<RecurrenceCalendar year={2026} month={9} occurrences={[row]}
                               onToggle={onToggle} pending={null} />);
    await userEvent.click(screen.getByRole("button", { name: /Netflix/ }));
    expect(onToggle).toHaveBeenCalledWith(row);
  });

  it("shows a ticked-off due date as pressed, and offers to un-tick it", () => {
    render(
      <RecurrenceCalendar year={2026} month={9} pending={null} onToggle={vi.fn()}
                          occurrences={[occurrence({ status: "pointed", paid_on: "2026-09-18" })]} />,
    );
    const control = screen.getByRole("button", { name: /Netflix/ });
    expect(control).toHaveAttribute("aria-pressed", "true");
    expect(control.getAttribute("aria-label")).toContain("dépointer");
  });

  it("carries the state in a class, so late does not look like upcoming", () => {
    const { container } = render(
      <RecurrenceCalendar year={2026} month={9} pending={null} onToggle={vi.fn()}
                          occurrences={[occurrence({ status: "late" })]} />,
    );
    expect(container.querySelector(".yd-rcal__event--late")).not.toBeNull();
  });

  it("disables the control whose write is in flight", () => {
    render(<RecurrenceCalendar year={2026} month={9} occurrences={[occurrence()]}
                               onToggle={vi.fn()} pending="1:2026-09-18" />);
    expect(screen.getByRole("button", { name: /Netflix/ })).toBeDisabled();
  });

  it("gives the weekday headings real column semantics", () => {
    render(<RecurrenceCalendar year={2026} month={9} occurrences={[]}
                               onToggle={vi.fn()} pending={null} />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim",
    ]);
  });
});
