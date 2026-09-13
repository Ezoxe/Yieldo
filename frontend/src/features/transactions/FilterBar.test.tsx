import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "./FilterBar";
import type { UsePeriodResult } from "./usePeriod";

type FilterBarProps = Parameters<typeof FilterBar>[0];

const accounts = [
  { id: 1, name: "Compte courant", kind: "checking", currency: "EUR",
    opening_balance_cents: 0, opened_on: null, include_in_net_worth: true, archived: false },
];

function makePeriod(overrides: Partial<UsePeriodResult> = {}): UsePeriodResult {
  return {
    preset: "month",
    monthOffset: 0,
    from: "2026-08-01",
    to: "2026-08-31",
    setPreset: vi.fn(),
    setMonth: vi.fn(),
    setRange: vi.fn(),
    ...overrides,
  };
}

function baseProps(overrides: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    period: makePeriod(),
    accounts,
    accountId: null,
    onAccountChange: vi.fn(),
    uncategorizedOnly: false,
    onUncategorizedOnlyChange: vi.fn(),
    uncategorizedCount: null,
    includeTransfers: false,
    onIncludeTransfersChange: vi.fn(),
    transferCount: null,
    onSearchChange: vi.fn(),
    ...overrides,
  };
}

describe("FilterBar", () => {
  it("marks the active period preset", () => {
    render(<FilterBar {...baseProps({ period: makePeriod({ preset: "quarter" }) })} />);
    expect(screen.getByRole("tab", { name: "Trimestre" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tout" })).toHaveAttribute("aria-selected", "false");
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

  // One box, not two. The category combobox that used to sit beside it was a
  // second thing that looked like a search and answered a different question.
  it("offers exactly one place to type", () => {
    render(<FilterBar {...baseProps()} />);

    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Filtrer par catégorie" }))
      .not.toBeInTheDocument();
  });

  it("says what the one box reaches", () => {
    render(<FilterBar {...baseProps()} />);

    expect(screen.getByRole("searchbox", { name: "Rechercher" })).toHaveAttribute(
      "placeholder",
      "Rechercher : libellé, montant, catégorie, compte, date…",
    );
  });

  it("starts on the term the header handed it", () => {
    render(<FilterBar {...baseProps({ initialSearch: "netflix" })} />);

    expect(screen.getByRole("searchbox", { name: "Rechercher" })).toHaveValue("netflix");
  });

  describe("debounced search", () => {
    it("waits 250ms of inactivity before reporting the search text", async () => {
      const onSearchChange = vi.fn();
      render(<FilterBar {...baseProps({ onSearchChange })} />);

      fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher" }), {
        target: { value: "netflix" },
      });

      expect(onSearchChange).not.toHaveBeenCalled();

      await waitFor(() => expect(onSearchChange).toHaveBeenCalledWith("netflix"), { timeout: 1000 });
    });
  });

  // Off by default, and the count says what that costs: a list silently
  // shortened is worse than no filter at all.
  it("offers to bring the internal transfers back, and says how many there are", async () => {
    const onIncludeTransfersChange = vi.fn();
    render(<FilterBar {...baseProps({ transferCount: 12, onIncludeTransfersChange })} />);

    const toggle = screen.getByRole("switch", { name: /Inclure les virements internes/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("(12)")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(onIncludeTransfersChange).toHaveBeenCalledWith(true);
  });

  it("shows no count while it is not known yet", () => {
    render(<FilterBar {...baseProps({ transferCount: null })} />);
    expect(
      screen.getByRole("switch", { name: "Inclure les virements internes" }),
    ).toBeInTheDocument();
  });

  /**
   * Seen at 390: the filter band took the first 250px of the screen before a
   * single row. The period and the one box stay in sight; the account select
   * and the two switches fold behind a button that says how many of them
   * are doing something to the list — a folded filter the reader forgot is
   * the shortened list this screen refuses.
   */
  describe("on a phone", () => {
    const realMatchMedia = window.matchMedia;

    function phone() {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string) => ({
          matches: query.includes("max-width: 639px"),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    }

    afterEach(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: realMatchMedia,
      });
    });

    it("folds the account and the switches behind « Filtres », keeping the box", () => {
      phone();
      render(<FilterBar {...baseProps()} />);

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
      const fold = screen.getByRole("button", { name: "Filtres" });
      expect(fold).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("switch", { name: /Non catégorisées/ })).not.toBeInTheDocument();
    });

    it("counts the filters that are doing something", () => {
      phone();
      render(<FilterBar {...baseProps({ accountId: 1, uncategorizedOnly: true })} />);
      expect(screen.getByRole("button", { name: "Filtres (2 actifs)" })).toBeInTheDocument();
    });

    it("unfolds on demand", async () => {
      phone();
      render(<FilterBar {...baseProps()} />);
      await userEvent.click(screen.getByRole("button", { name: "Filtres" }));
      expect(screen.getByRole("switch", { name: /Non catégorisées/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Filtres" })).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("never folds anything where there is room", () => {
    render(<FilterBar {...baseProps()} />);
    expect(screen.queryByRole("button", { name: /Filtres/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Non catégorisées/ })).toBeInTheDocument();
  });
});
