import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TransactionRow } from "./TransactionRow";

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./TransactionsPage.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule for "${selector}" in TransactionsPage.css`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
];

const transaction = {
  id: 10, account_id: 1, date: "2025-03-01", value_date: null, amount_cents: -4732,
  label_raw: "CARREFOUR MARKET CB 01/03", label_clean: "carrefour market",
  category_id: 2, category_source: "builtin", is_transfer: false,
  is_recurring: false, notes: null, tags: [],
};

describe("TransactionRow", () => {
  it("shows a debit in French formatting", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("−47,32 €")).toBeInTheDocument();
  });

  it("shows the raw label so the user recognizes the line on their statement", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("CARREFOUR MARKET CB 01/03")).toBeInTheDocument();
  });

  it("marks where the category came from", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByTitle("Catégorie déduite d'une règle intégrée")).toBeInTheDocument();
  });

  it("labels an uncategorized transaction explicitly", () => {
    render(<TransactionRow
      transaction={{ ...transaction, category_id: null, category_source: "uncategorized" }}
      categories={categories} onRecategorize={vi.fn()} />);
    expect(screen.getByText("Non catégorisé")).toBeInTheDocument();
  });

  it("reports the chosen category when the user recategorizes", async () => {
    const onRecategorize = vi.fn();
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={onRecategorize} />);
    await userEvent.selectOptions(screen.getByLabelText("Catégorie"), "1");
    expect(onRecategorize).toHaveBeenCalledWith(10, 1);
  });

  it("sends null -- not a coerced zero -- when Non catégorisé is chosen", async () => {
    const onRecategorize = vi.fn();
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={onRecategorize} />);
    await userEvent.selectOptions(screen.getByLabelText("Catégorie"), "");
    expect(onRecategorize).toHaveBeenCalledWith(10, null);
  });

  it("renders a credit with the positive tone", () => {
    render(<TransactionRow transaction={{ ...transaction, amount_cents: 245000 }}
                           categories={categories} onRecategorize={vi.fn()} />);
    expect(screen.getByText("2 450,00 €")).toHaveClass("yd-amount--positive");
  });

  // The class was applied before this task but nothing in the stylesheet
  // matched it: the colour came from an inline style, where no theme, no
  // stylesheet and no test could reach it.
  it("renders a debit with the negative tone, carried by the class and not an inline style", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    const amount = screen.getByText("−47,32 €");
    expect(amount).toHaveClass("yd-amount--negative");
    expect(amount.getAttribute("style")).toBeNull();
  });

  it("colours both tones from tokens, in the stylesheet", () => {
    expect(ruleBody(".yd-amount--negative")).toMatch(/color:\s*var\(--yd-negative\)/);
    expect(ruleBody(".yd-amount--positive")).toMatch(/color:\s*var\(--yd-positive\)/);
  });

  // Under 600px a row is laid out as a two-line grid, which means the table
  // boxes stop being table boxes and the browser stops inferring table
  // semantics from them. The roles are written down instead of implied, so the
  // row stays a row and the four cells stay cells at every width. jsdom has no
  // layout, so this asserts the declaration; the rendered result is in
  // task-4-report.md.
  it("declares its table semantics instead of leaving them to the layout", () => {
    const { container } = render(<TransactionRow transaction={transaction} categories={categories}
                                                 onRecategorize={vi.fn()} />);
    // The attribute, not the inferred role: jsdom infers `row`/`cell` from the
    // tag whatever the stylesheet says, so only the written-down role proves
    // the semantics survive `display: grid` in a real browser.
    expect(container.querySelector("tr")).toHaveAttribute("role", "row");
    expect(container.querySelectorAll('td[role="cell"]')).toHaveLength(4);
  });

  // The defect: at 375 the category column was 5.4rem, so every picker read
  // "Livrai" / "Salair" / "Remb" -- present, aligned, and carrying no
  // information at all. It gets its own line under the label now.
  it("gives the category a line of its own on a phone", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 599px)"));
    expect(phone).toMatch(/grid-template-areas:\s*"date label amount"\s+"\.\s+category category"/);
  });

  // Amounts are a column to be compared down, not prose: tabular figures in
  // the mono family, right-aligned. `.yd-num` carries the first two.
  it("keeps the amount in the tabular figure style", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("−47,32 €")).toHaveClass("yd-num");
    expect(ruleBody(".yd-transactions__cell--amount")).toMatch(/text-align:\s*right/);
  });
});
