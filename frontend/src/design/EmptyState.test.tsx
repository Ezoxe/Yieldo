import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState, frenchDate, historySentence } from "./EmptyState";

describe("frenchDate", () => {
  it("writes the first of the month as 1er, and every other day bare", () => {
    expect(frenchDate("2025-01-01")).toBe("1er janvier 2025");
    expect(frenchDate("2025-01-24")).toBe("24 janvier 2025");
  });

  it("reads the date in UTC, so a negative-offset zone never shifts it a day back", () => {
    expect(frenchDate("2026-01-09")).toBe("9 janvier 2026");
  });
});

describe("historySentence", () => {
  it("says where the data actually is, with the count that makes it concrete", () => {
    expect(
      historySentence({ date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 }),
    ).toBe("Vos 197 opérations vont du 24 janvier 2025 au 9 janvier 2026.");
  });

  // "Vos 1 opération va du 1er mars 2025 au 1er mars 2025." is not French, and
  // it is reachable: one transaction, with the period pointed somewhere else.
  it("agrees in the singular, without naming the same date twice", () => {
    expect(
      historySentence({ date_from: "2025-03-01", date_to: "2025-03-01", transaction_count: 1 }),
    ).toBe("Votre seule opération date du 1er mars 2025.");
  });
});

describe("EmptyState", () => {
  it("omits the detail and the action row entirely rather than rendering empty boxes", () => {
    const { container } = render(<EmptyState title="Rien ici." />);

    expect(screen.getByText("Rien ici.")).toBeInTheDocument();
    expect(container.querySelector(".yd-empty__detail")).toBeNull();
    expect(container.querySelector(".yd-empty__actions")).toBeNull();
  });

  it("renders the diagnosis and the way out together", () => {
    render(
      <EmptyState title="Rien ici." detail="Vos données sont ailleurs.">
        <button type="button">Y aller</button>
      </EmptyState>,
    );

    expect(screen.getByText("Vos données sont ailleurs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Y aller" })).toBeInTheDocument();
  });
});
