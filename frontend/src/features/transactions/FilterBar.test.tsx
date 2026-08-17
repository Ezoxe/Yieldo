import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterBar } from "./FilterBar";
import type { UsePeriodResult } from "./usePeriod";

type FilterBarProps = Parameters<typeof FilterBar>[0];

const accounts = [
  { id: 1, name: "Compte courant", kind: "checking", currency: "EUR",
    opening_balance_cents: 0, opened_on: null, include_in_net_worth: true, archived: false },
];

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
];

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

function baseProps(overrides: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    period: makePeriod(),
    accounts,
    categories,
    accountId: null,
    onAccountChange: vi.fn(),
    categoryId: null,
    onCategoryChange: vi.fn(),
    uncategorizedOnly: false,
    onUncategorizedOnlyChange: vi.fn(),
    uncategorizedCount: null,
    onSearchChange: vi.fn(),
    ...overrides,
  };
}

describe("FilterBar", () => {
  it("marks the active period preset", () => {
    render(<FilterBar {...baseProps({ period: makePeriod({ preset: "quarter" }) })} />);
    expect(screen.getByRole("tab", { name: "Trimestre" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Mois" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the preset when a tab is clicked", async () => {
    const period = makePeriod();
    const user = userEvent.setup();
    render(<FilterBar {...baseProps({ period })} />);

    await user.click(screen.getByRole("tab", { name: "Année" }));

    expect(period.setPreset).toHaveBeenCalledWith("year");
  });

  it("shows custom range inputs only for the custom preset", () => {
    const { rerender } = render(<FilterBar {...baseProps()} />);
    expect(screen.queryByLabelText("Du")).not.toBeInTheDocument();

    rerender(
      <FilterBar
        {...baseProps({ period: makePeriod({ preset: "custom", from: "2026-01-01", to: "2026-02-01" }) })}
      />,
    );
    expect(screen.getByLabelText("Du")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Au")).toHaveValue("2026-02-01");
  });

  it("reports the chosen account", async () => {
    const onAccountChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar {...baseProps({ onAccountChange })} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Compte" }), "1");

    expect(onAccountChange).toHaveBeenCalledWith(1);
  });

  it("toggles uncategorized-only and reports the change", async () => {
    const onUncategorizedOnlyChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar {...baseProps({ onUncategorizedOnlyChange })} />);

    await user.click(screen.getByRole("switch", { name: /Non catégorisées uniquement/ }));

    expect(onUncategorizedOnlyChange).toHaveBeenCalledWith(true);
  });

  it("shows the matching count once uncategorized-only is on", () => {
    render(<FilterBar {...baseProps({ uncategorizedOnly: true, uncategorizedCount: 7 })} />);

    expect(screen.getByRole("switch", { name: /Non catégorisées uniquement/ })).toBeChecked();
    expect(screen.getByText("(7)")).toBeInTheDocument();
  });

  describe("debounced search", () => {
    it("waits 250ms of inactivity before reporting the search text", async () => {
      const onSearchChange = vi.fn();
      render(<FilterBar {...baseProps({ onSearchChange })} />);

      fireEvent.change(screen.getByPlaceholderText("Rechercher un libellé…"), {
        target: { value: "netflix" },
      });

      expect(onSearchChange).not.toHaveBeenCalled();

      await waitFor(() => expect(onSearchChange).toHaveBeenCalledWith("netflix"), { timeout: 1000 });
    });
  });
});
