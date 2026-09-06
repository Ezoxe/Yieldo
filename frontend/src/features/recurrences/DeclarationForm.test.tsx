import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Account, Category } from "../../lib/types";
import { DeclarationForm } from "./DeclarationForm";
import { basisNote, monthBounds } from "./DeclaredRecurrences";

const categories: Category[] = [
  { id: 1, parent_id: null, name: "Logement", slug: "logement", kind: "expense",
    color: "#8ab4f8", icon: "home", monthly_budget_cents: null, is_essential: true },
];

const accounts: Account[] = [
  { id: 1, name: "Compte courant", kind: "checking", currency: "EUR",
    opening_balance_cents: 0, opened_on: null, include_in_net_worth: true,
    archived: false },
];

function renderForm(overrides: Partial<Parameters<typeof DeclarationForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <DeclarationForm
      initial={null}
      categories={categories}
      accounts={accounts}
      busy={false}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
  return onSubmit;
}

describe("DeclarationForm", () => {
  /**
   * The sign is asked as a question, never typed as a minus. A reader who
   * forgets the minus declares a 950 € rent as income, and every total on the
   * screen quietly inverts.
   */
  it("sends a charge as a negative amount", async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText("Nom"), "Loyer");
    await userEvent.type(screen.getByLabelText("Montant"), "780");
    await userEvent.click(screen.getByRole("button", { name: "Déclarer" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Loyer", amount_cents: -78_000 }),
    );
  });

  it("sends an income as a positive amount", async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText("Nom"), "Salaire");
    await userEvent.type(screen.getByLabelText("Montant"), "2980");
    await userEvent.click(screen.getByRole("radio", { name: "Un revenu" }));
    await userEvent.click(screen.getByRole("button", { name: "Déclarer" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 298_000 }),
    );
  });

  it("refuses an unreadable amount rather than sending whatever it parses as", async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText("Nom"), "Loyer");
    await userEvent.type(screen.getByLabelText("Montant"), "sept-cent");
    await userEvent.click(screen.getByRole("button", { name: "Déclarer" }));

    expect(screen.getByText(/Montant illisible/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses a name that is only spaces", async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText("Montant"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Déclarer" }));

    expect(screen.getByText(/Donnez un nom/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses an end date that precedes the first due date", async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText("Nom"), "Loyer");
    await userEvent.type(screen.getByLabelText("Montant"), "780");
    await userEvent.clear(screen.getByLabelText("Première échéance"));
    await userEvent.type(screen.getByLabelText("Première échéance"), "2026-05-01");
    await userEvent.type(screen.getByLabelText("Fin (facultatif)"), "2026-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Déclarer" }));

    expect(screen.getByText(/ne peut pas précéder/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // What lets water and electricity be declared at all: the detection engine
  // refuses a charge whose amount wanders, and this is the household saying
  // "it wanders, and that is normal".
  it("lets the household say the amount varies", async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText("Nom"), "Électricité");
    await userEvent.type(screen.getByLabelText("Montant"), "65");
    await userEvent.click(
      screen.getByRole("switch", { name: /Le montant varie/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Déclarer" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amount_is_variable: true }),
    );
  });

  it("opens on the values of the declaration being corrected", () => {
    renderForm({
      initial: {
        id: 3, label: "Eau", amount_cents: -3_200, amount_is_variable: true,
        periodicity: "quarterly", anchor_on: "2025-10-12", ends_on: null,
        category_id: 1, account_id: 1, active: true, notes: null,
      },
    });

    expect(screen.getByLabelText("Nom")).toHaveValue("Eau");
    // The magnitude, because the sign lives in the direction control.
    expect(screen.getByLabelText("Montant")).toHaveValue("32,00");
    expect(screen.getByRole("radio", { name: "Une dépense" })).toBeChecked();
    expect(screen.getByLabelText("Rythme")).toHaveValue("quarterly");
  });
});

describe("basisNote", () => {
  /**
   * An estimate and a measurement are different claims. A variable charge
   * costed on the household's own guess must say so, or the screen prints a
   * number that merely looks measured.
   */
  it("says a variable charge is still an estimate until three are pointed", () => {
    const note = basisNote(
      { schedule_id: 1, label: "Eau", amount_cents: -3_200,
        amount_basis: "declared", annual_cents: -12_800, observations: 1 },
      true,
    );
    expect(note).toContain("Estimation");
    expect(note).toContain("trois");
  });

  it("says a variable charge is measured once it is", () => {
    const note = basisNote(
      { schedule_id: 1, label: "Eau", amount_cents: -6_800,
        amount_basis: "observed", annual_cents: -27_200, observations: 3 },
      true,
    );
    expect(note).toBe("Mesuré sur 3 échéances pointées.");
  });

  it("says nothing about a fixed charge, whose amount was never in doubt", () => {
    expect(
      basisNote(
        { schedule_id: 1, label: "Netflix", amount_cents: -1_599,
          amount_basis: "declared", annual_cents: -19_188, observations: 0 },
        false,
      ),
    ).toBeNull();
  });
});

describe("monthBounds", () => {
  it("spans the whole month, February included", () => {
    expect(monthBounds(2026, 9)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(monthBounds(2025, 2)).toEqual(["2025-02-01", "2025-02-28"]);
    expect(monthBounds(2024, 2)).toEqual(["2024-02-01", "2024-02-29"]);
  });
});
