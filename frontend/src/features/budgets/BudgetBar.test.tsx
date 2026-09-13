import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { BudgetHistoryLine, BudgetLine } from "../../lib/types";
import { BudgetBar, consumedPercent, fillPercent } from "./BudgetBar";
import { suggestedCeiling } from "./BudgetsPage";

const line: BudgetLine = {
  category_id: 1,
  name: "Courses",
  color: "#4fd6a8",
  is_essential: true,
  budget_cents: 30000,
  spent_cents: -24000,
  remaining_cents: 6000,
  consumed_ratio: 0.8,
  projected_cents: null,
  status: "ok",
};

describe("consumedPercent", () => {
  it("rounds the consumed share to a whole percentage", () => {
    expect(consumedPercent(0.804)).toBe(80);
  });

  it("caps at 100", () => {
    expect(consumedPercent(3.4)).toBe(100);
  });

  it("never goes negative", () => {
    expect(consumedPercent(-1)).toBe(0);
  });
});

describe("fillPercent", () => {
  it("is the consumed share as a percentage string", () => {
    expect(fillPercent(0.8)).toBe("80%");
  });

  it("caps at 100 so a threefold overrun does not overflow the row", () => {
    expect(fillPercent(3.4)).toBe("100%");
  });

  it("never goes negative", () => {
    expect(fillPercent(-1)).toBe("0%");
  });

  // One clamp, not two. The width drawn and the value announced are the same
  // rule or they can drift: a bar can only be wrong about itself once.
  it("is `consumedPercent` and nothing else", () => {
    for (const ratio of [-2, 0, 0.333, 0.805, 1, 1.15, 3.4]) {
      expect(fillPercent(ratio)).toBe(`${consumedPercent(ratio)}%`);
    }
  });
});

describe("BudgetBar", () => {
  it("names the category and states both figures", () => {
    render(<BudgetBar line={line} />);
    expect(screen.getByText("Courses")).toBeInTheDocument();
    // Spent as a magnitude, never "−240,00 € sur 300,00 €".
    expect(screen.getByText(/240,00/)).toBeInTheDocument();
    expect(screen.getByText(/300,00/)).toBeInTheDocument();
  });

  it("exposes the consumption as a progress bar with its real value", () => {
    render(<BudgetBar line={line} />);
    const bar = screen.getByRole("progressbar", { name: /Courses/ });
    expect(bar).toHaveAttribute("aria-valuenow", "80");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("draws the fill and announces the value from the same clamped figure", () => {
    render(
      <BudgetBar
        line={{
          ...line,
          spent_cents: -102000,
          remaining_cents: -72000,
          consumed_ratio: 3.4,
          status: "over",
        }}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: /Courses/ });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar.firstElementChild).toHaveStyle({ width: fillPercent(3.4) });
  });

  it("says what is left in words, not only in colour", () => {
    render(<BudgetBar line={line} />);
    expect(screen.getByText(/Il reste/)).toBeInTheDocument();
  });

  it("says how much was overspent when the ceiling is passed", () => {
    render(<BudgetBar line={{ ...line, spent_cents: -34500, remaining_cents: -4500, consumed_ratio: 1.15, status: "over" }} />);
    expect(screen.getByText(/Dépassé de/)).toBeInTheDocument();
    expect(screen.getByText(/Dépassé de 45,00/)).toBeInTheDocument();
  });

  // The projection moved behind a mark rather than being printed under every
  // row: twelve categories each carrying a three-line sentence is what buried
  // the figures the screen exists to show. It is still one interaction away,
  // and still exact.
  it("states the projection once the reader asks for it", async () => {
    const user = userEvent.setup();
    render(<BudgetBar line={{ ...line, spent_cents: -20000, remaining_cents: 10000, consumed_ratio: 0.67, projected_cents: -41333, status: "at_risk" }} />);

    expect(screen.queryByText(/À ce rythme/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Projection du budget Courses/ }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(/À ce rythme/);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/413,33/);
  });

  it("offers no projection mark when there is no pace to project", () => {
    render(<BudgetBar line={line} />);
    expect(screen.queryByRole("button", { name: /Projection/ })).not.toBeInTheDocument();
  });
});

// The ceiling proposed for a category that has none. One month is not an
// average, and the panel says so on screen — but a suggestion drawn from the
// one figure this screen has beats an empty field.
describe("suggestedCeiling", () => {
  it("rounds the observed spend up to the next ten euros", () => {
    expect(suggestedCeiling(-24312)).toBe("250");
    expect(suggestedCeiling(-25000)).toBe("250");
    expect(suggestedCeiling(-25001)).toBe("260");
  });

  it("takes the magnitude, whichever sign the payload carries", () => {
    expect(suggestedCeiling(24312)).toBe(suggestedCeiling(-24312));
  });

  // A category that cost 3,20 € would otherwise propose a ceiling of 0.
  it("never proposes a ceiling of zero", () => {
    expect(suggestedCeiling(-320)).toBe("10");
    expect(suggestedCeiling(0)).toBe("10");
  });
});

afterEach(() => vi.restoreAllMocks());

/**
 * The ceiling used to be a figure the reader could only change from another
 * screen. It is now a button on the row that opens a field in place; Enter
 * or a lost focus saves, Escape gives up, and the screen re-asks for its
 * report through `onSaved` so the bar and the totals move together.
 */
describe("BudgetBar — the ceiling edited in place", () => {
  it("opens the ceiling as a field, saves in cents, and reports the save", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({});
    const onSaved = vi.fn();
    render(<BudgetBar line={line} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole("button", { name: "Modifier le plafond de Courses" }));
    const field = screen.getByRole("textbox", { name: "Plafond mensuel pour Courses" });
    await userEvent.clear(field);
    await userEvent.type(field, "480,50{Enter}");

    expect(patch).toHaveBeenCalledWith(`/categories/${line.category_id}`, {
      monthly_budget_cents: 48_050,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("refuses an unreadable amount at the field, without calling the API", async () => {
    const patch = vi.spyOn(api, "patch");
    render(<BudgetBar line={line} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Modifier le plafond/ }));
    const field = screen.getByRole("textbox", { name: /Plafond mensuel/ });
    await userEvent.clear(field);
    await userEvent.type(field, "quatre cents{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/Montant invalide/);
    expect(patch).not.toHaveBeenCalled();
  });

  it("gives up on Escape and shows the figure again", async () => {
    render(<BudgetBar line={line} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Modifier le plafond/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Modifier le plafond/ })).toBeInTheDocument();
  });

  it("stays a plain figure when the screen gives it nothing to save through", () => {
    render(<BudgetBar line={line} />);
    expect(screen.queryByRole("button", { name: /Modifier le plafond/ })).not.toBeInTheDocument();
  });
});

describe("BudgetBar — six months under the line", () => {
  const history: BudgetHistoryLine = {
    category_id: line.category_id, name: line.name, color: line.color, budget_cents: 45_000,
    points: [
      { month: "2026-03", spent_cents: -38_000 }, { month: "2026-04", spent_cents: -52_000 },
      { month: "2026-05", spent_cents: -41_000 }, { month: "2026-06", spent_cents: -44_000 },
      { month: "2026-07", spent_cents: -47_000 }, { month: "2026-08", spent_cents: -30_000 },
    ],
  };

  it("draws one bar per month and says in words how many months crossed the ceiling", () => {
    render(<BudgetBar line={line} history={history} />);
    const spark = screen.getByRole("img", { name: /6 derniers mois/ });
    expect(spark).toHaveAccessibleName(/2 mois au-dessus du plafond/);
    expect(spark.querySelectorAll("rect.yd-budget-spark__bar")).toHaveLength(6);
    expect(spark.querySelectorAll("rect.yd-budget-spark__bar--over")).toHaveLength(2);
  });

  it("draws nothing without a history", () => {
    render(<BudgetBar line={line} />);
    expect(screen.queryByRole("img", { name: /derniers mois/ })).not.toBeInTheDocument();
  });
});
