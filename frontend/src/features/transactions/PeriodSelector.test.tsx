import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { monthChipLabel, PeriodSelector } from "./PeriodSelector";
import type { UsePeriodResult } from "./usePeriod";

const TODAY = new Date("2026-09-05T12:00:00Z");

function makePeriod(overrides: Partial<UsePeriodResult> = {}): UsePeriodResult {
  return {
    preset: "month",
    monthOffset: -1,
    from: "2026-08-01",
    to: "2026-08-31",
    setPreset: vi.fn(),
    setMonth: vi.fn(),
    setRange: vi.fn(),
    ...overrides,
  };
}

describe("monthChipLabel", () => {
  it("names the month without a year when it is the current one", () => {
    expect(monthChipLabel(TODAY, 0)).toBe("Septembre");
    expect(monthChipLabel(TODAY, -1)).toBe("Août");
    expect(monthChipLabel(TODAY, -2)).toBe("Juillet");
  });

  // Otherwise "Novembre" in January is a month eleven months ahead as easily
  // as two months behind.
  it("adds the year once the offset crosses back into the previous one", () => {
    const january = new Date("2027-01-12T00:00:00Z");
    expect(monthChipLabel(january, 0)).toBe("Janvier");
    expect(monthChipLabel(january, -1)).toBe("Décembre 2026");
    expect(monthChipLabel(january, -2)).toBe("Novembre 2026");
  });
});

describe("PeriodSelector", () => {
  it("marks the active period preset", () => {
    render(<PeriodSelector period={makePeriod({ preset: "quarter" })} today={TODAY} />);
    expect(screen.getByRole("tab", { name: "Trimestre" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Année" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the preset when a tab is clicked", async () => {
    const period = makePeriod();
    const user = userEvent.setup();
    render(<PeriodSelector period={period} today={TODAY} />);

    await user.click(screen.getByRole("tab", { name: "Année" }));

    expect(period.setPreset).toHaveBeenCalledWith("year");
  });

  it("marks the selected month chip and no other", () => {
    render(<PeriodSelector period={makePeriod({ monthOffset: -1 })} today={TODAY} />);

    expect(screen.getByRole("tab", { name: "Août" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Septembre" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Juillet" })).toHaveAttribute("aria-selected", "false");
  });

  it("selects a month in one write when its chip is clicked", async () => {
    const period = makePeriod();
    const user = userEvent.setup();
    render(<PeriodSelector period={period} today={TODAY} />);

    await user.click(screen.getByRole("tab", { name: "Juillet" }));

    expect(period.setMonth).toHaveBeenCalledWith(-2);
  });

  // A quarter is selected, so no month is the current one -- but the chips are
  // still there to jump back to one.
  it("marks no chip while another preset is active", () => {
    render(<PeriodSelector period={makePeriod({ preset: "year" })} today={TODAY} />);

    for (const name of ["Juillet", "Août", "Septembre"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "false");
    }
  });

  it("shows custom range inputs only for the custom preset", () => {
    const { rerender } = render(<PeriodSelector period={makePeriod()} today={TODAY} />);
    expect(screen.queryByLabelText("Du")).not.toBeInTheDocument();

    rerender(
      <PeriodSelector
        period={makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" })}
        today={TODAY}
      />,
    );
    expect(screen.getByLabelText("Du")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Au")).toHaveValue("2026-02-01");
  });

  it("reports an edited custom range once the field is left", async () => {
    const period = makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" });
    const user = userEvent.setup();
    render(<PeriodSelector period={period} today={TODAY} />);

    await user.clear(screen.getByLabelText("Du"));
    await user.type(screen.getByLabelText("Du"), "2026-01-15");
    await user.tab();

    expect(period.setRange).toHaveBeenCalledWith("2026-01-15", "2026-02-01");
  });

  // The bug this pins down: a native date input fires a change for every
  // keystroke that leaves it parseable, so the first digit of the year is the
  // perfectly valid year 2. Committing those wrote the URL four times, and
  // each new value handed back to the field reset the segments the user was
  // still typing into -- the day and month vanished.
  it("does not report a date still being typed", () => {
    const period = makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" });
    render(<PeriodSelector period={period} today={TODAY} />);
    const input = screen.getByLabelText("Du");

    for (const partial of ["0002-09-05", "0020-09-05", "0202-09-05", "2026-09-05"]) {
      fireEvent.change(input, { target: { value: partial } });
    }
    expect(period.setRange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(period.setRange).toHaveBeenCalledTimes(1);
    expect(period.setRange).toHaveBeenCalledWith("2026-09-05", "2026-02-01");
  });

  it("commits on Enter without waiting for the field to be left", () => {
    const period = makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" });
    render(<PeriodSelector period={period} today={TODAY} />);
    const input = screen.getByLabelText("Au");

    fireEvent.change(input, { target: { value: "2026-03-31" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(period.setRange).toHaveBeenCalledWith("2026-01-01", "2026-03-31");
  });

  it("adopts a range changed from outside while the inputs are on screen", () => {
    const { rerender } = render(
      <PeriodSelector
        period={makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" })}
        today={TODAY}
      />,
    );
    rerender(
      <PeriodSelector
        period={makePeriod({ preset: "custom", from: "2025-06-01", to: "2025-06-30" })}
        today={TODAY}
      />,
    );

    expect(screen.getByLabelText("Du")).toHaveValue("2025-06-01");
    expect(screen.getByLabelText("Au")).toHaveValue("2025-06-30");
  });
});
