import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PeriodSelector } from "./PeriodSelector";
import type { UsePeriodResult } from "./usePeriod";

function makePeriod(overrides: Partial<UsePeriodResult> = {}): UsePeriodResult {
  return {
    preset: "month",
    from: "2026-08-01",
    to: "2026-08-31",
    setPreset: vi.fn(),
    setRange: vi.fn(),
    ...overrides,
  };
}

describe("PeriodSelector", () => {
  it("marks the active period preset", () => {
    render(<PeriodSelector period={makePeriod({ preset: "quarter" })} />);
    expect(screen.getByRole("tab", { name: "Trimestre" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Mois" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the preset when a tab is clicked", async () => {
    const period = makePeriod();
    const user = userEvent.setup();
    render(<PeriodSelector period={period} />);

    await user.click(screen.getByRole("tab", { name: "Année" }));

    expect(period.setPreset).toHaveBeenCalledWith("year");
  });

  it("shows custom range inputs only for the custom preset", () => {
    const { rerender } = render(<PeriodSelector period={makePeriod()} />);
    expect(screen.queryByLabelText("Du")).not.toBeInTheDocument();

    rerender(
      <PeriodSelector period={makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" })} />,
    );
    expect(screen.getByLabelText("Du")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Au")).toHaveValue("2026-02-01");
  });

  it("reports an edited custom range", async () => {
    const period = makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" });
    const user = userEvent.setup();
    render(<PeriodSelector period={period} />);

    await user.clear(screen.getByLabelText("Du"));
    await user.type(screen.getByLabelText("Du"), "2026-01-15");

    expect(period.setRange).toHaveBeenCalled();
  });
});
