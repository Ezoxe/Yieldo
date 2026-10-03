import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Category, Transaction } from "../../lib/types";
import { TransactionSheet } from "./TransactionSheet";

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
  { id: 3, parent_id: 1, name: "Restaurants", slug: "alimentation-restaurants",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
] as Category[];

const transaction = {
  id: 10, account_id: 1, date: "2026-09-24", value_date: null, amount_cents: -4732,
  label_raw: "CB CARREFOUR MARKET", label_clean: "carrefour market",
  category_id: 2, category_source: "builtin", is_transfer: false, transfer_source: "auto",
  is_recurring: false, notes: null, tags: [], manual: false,
} as Transaction;

function renderSheet(overrides: Partial<Parameters<typeof TransactionSheet>[0]> = {}) {
  const props = {
    transaction,
    categories,
    onClose: vi.fn(),
    onRecategorize: vi.fn(),
    onToggleTransfer: vi.fn(),
    onEdit: vi.fn(),
    ...overrides,
  };
  render(<TransactionSheet {...props} />);
  return props;
}

describe("TransactionSheet", () => {
  it("is named by the operation, with its date and its amount", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "CB CARREFOUR MARKET" })).toBeInTheDocument();
    expect(screen.getByText("24 septembre 2026")).toBeInTheDocument();
    expect(screen.getByText("−47,32 €")).toBeInTheDocument();
  });

  it("changes the category from its own picker", async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    const picker = screen.getByRole("combobox", { name: "Catégorie" });
    expect(picker).toHaveValue("2");
    await user.selectOptions(picker, "3");
    expect(props.onRecategorize).toHaveBeenCalledWith(10, 3);
  });

  it("marks the operation as an internal transfer, saying what it does", async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    const toggle = screen.getByRole("button", { name: "Marquer comme virement interne" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(props.onToggleTransfer).toHaveBeenCalledWith(10, true);
  });

  it("hands the operation to the edit form", async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    await user.click(screen.getByRole("button", { name: "Modifier l'opération" }));
    expect(props.onEdit).toHaveBeenCalledWith(transaction);
  });

  it("is closed while no operation is chosen", () => {
    renderSheet({ transaction: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
