import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { BudgetLine } from "../../lib/types";
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
