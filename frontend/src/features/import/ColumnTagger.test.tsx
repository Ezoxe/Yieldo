import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColumnTagger } from "./ColumnTagger";

const headers = ["dateOp", "label", "amount"];
const sampleRows = [
  ["01/03/2025", "CARREFOUR MARKET", "-47,32"],
  ["03/03/2025", "VIR SALAIRE", "2450,00"],
];

function renderTagger(overrides = {}) {
  const onRoleChange = vi.fn();
  render(
    <ColumnTagger
      headers={headers}
      sampleRows={sampleRows}
      mapping={{ 0: "date", 1: "label", 2: "amount" }}
      onRoleChange={onRoleChange}
      errors={[]}
      {...overrides}
    />,
  );
  return { onRoleChange };
}

describe("ColumnTagger", () => {
  it("renders one role selector per column, labelled by the header", () => {
    renderTagger();
    expect(screen.getByLabelText('Rôle de la colonne "dateOp"')).toBeInTheDocument();
    expect(screen.getByLabelText('Rôle de la colonne "label"')).toBeInTheDocument();
    expect(screen.getByLabelText('Rôle de la colonne "amount"')).toBeInTheDocument();
  });

  it("preselects the suggested role without locking it", () => {
    renderTagger();
    const select = screen.getByLabelText('Rôle de la colonne "dateOp"') as HTMLSelectElement;
    expect(select.value).toBe("date");
    expect(select).toBeEnabled();
  });

  it("offers every role in French", () => {
    renderTagger();
    const select = screen.getByLabelText('Rôle de la colonne "amount"');
    expect(within(select).getByRole("option", { name: "Débit" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Ignorer" })).toBeInTheDocument();
  });

  it("reports the column index and the new role when the user retags", async () => {
    const { onRoleChange } = renderTagger();
    await userEvent.selectOptions(
      screen.getByLabelText('Rôle de la colonne "amount"'),
      "debit",
    );
    expect(onRoleChange).toHaveBeenCalledWith(2, "debit");
  });

  it("shows sample values under each column so the user can check the tagging", () => {
    renderTagger();
    expect(screen.getByText("CARREFOUR MARKET")).toBeInTheDocument();
    expect(screen.getByText("-47,32")).toBeInTheDocument();
  });

  it("surfaces mapping errors in an alert", () => {
    renderTagger({ errors: ["Aucune colonne n'est taggée comme Date."] });
    expect(screen.getByRole("alert")).toHaveTextContent("Aucune colonne n'est taggée comme Date.");
  });

  it("handles a file whose header row is empty by numbering the columns", () => {
    render(
      <ColumnTagger
        headers={["", ""]}
        sampleRows={[["a", "b"]]}
        mapping={{ 0: "ignore", 1: "ignore" }}
        onRoleChange={vi.fn()}
        errors={[]}
      />,
    );
    expect(screen.getByLabelText("Rôle de la colonne 1")).toBeInTheDocument();
  });
});
