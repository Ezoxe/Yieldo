import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, Category, Transaction } from "../../lib/types";
import {
  centsToAmountInput,
  isCompleteDate,
  parseAmountToCents,
  TransactionForm,
  todayIso,
} from "./TransactionForm";

const accounts: Account[] = [
  { id: 1, name: "Compte courant", kind: "checking", currency: "EUR",
    opening_balance_cents: 0, opened_on: null, include_in_net_worth: true, archived: false },
  { id: 2, name: "Livret A", kind: "savings", currency: "EUR",
    opening_balance_cents: 0, opened_on: null, include_in_net_worth: true, archived: false },
];

const categories: Category[] = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation", kind: "expense",
    color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
];

const fetchMock = vi.fn();

function created(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 201,
    json: async () => ({ id: 99, manual: true, ...overrides }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(created());
  vi.stubGlobal("fetch", fetchMock);
});

function renderForm(props: Partial<Parameters<typeof TransactionForm>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <TransactionForm
      open
      onClose={onClose}
      accounts={accounts}
      categories={categories}
      onSaved={onSaved}
      today={new Date("2026-09-05T10:00:00Z")}
      {...props}
    />,
  );
  return { onSaved, onClose };
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}

// Cents, never a float: the arithmetic is what the whole application is built
// on, so it is checked directly rather than only through the form.
describe("parseAmountToCents", () => {
  it("reads whole euros", () => {
    expect(parseAmountToCents("12")).toBe(1200);
  });

  it("reads both decimal separators", () => {
    expect(parseAmountToCents("12,50")).toBe(1250);
    expect(parseAmountToCents("12.50")).toBe(1250);
  });

  it("pads a single decimal", () => {
    expect(parseAmountToCents("12,5")).toBe(1250);
  });

  // 12.10 * 100 is 1209.9999999999998 in binary floating point. This is the
  // case that says the two halves are read as integers.
  it("does not lose a cent to floating point", () => {
    expect(parseAmountToCents("12,10")).toBe(1210);
    expect(parseAmountToCents("0,07")).toBe(7);
    expect(parseAmountToCents("1234,56")).toBe(123456);
  });

  it("ignores the spaces a thousands separator leaves behind", () => {
    expect(parseAmountToCents("1 234,56")).toBe(123456);
    expect(parseAmountToCents("1 234,56")).toBe(123456);
  });

  it("refuses anything that is not a plain positive amount", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("0")).toBeNull();
    expect(parseAmountToCents("-12")).toBeNull();
    expect(parseAmountToCents("12,345")).toBeNull();
    expect(parseAmountToCents("douze")).toBeNull();
  });
});

describe("centsToAmountInput", () => {
  it("reads stored cents back into the field, unsigned", () => {
    expect(centsToAmountInput(-1250)).toBe("12,50");
    expect(centsToAmountInput(4000)).toBe("40,00");
    expect(centsToAmountInput(-7)).toBe("0,07");
    expect(centsToAmountInput(123456)).toBe("1234,56");
  });
});

describe("isCompleteDate", () => {
  it("accepts a date the reader has finished writing", () => {
    expect(isCompleteDate("2026-12-08")).toBe(true);
  });

  it("refuses the years a half-typed field parses as", () => {
    expect(isCompleteDate("0002-12-08")).toBe(false);
    expect(isCompleteDate("0208-12-08")).toBe(false);
    expect(isCompleteDate("")).toBe(false);
    expect(isCompleteDate("2026-12")).toBe(false);
  });
});

describe("todayIso", () => {
  it("returns the local calendar day, not a UTC one", () => {
    expect(todayIso(new Date("2026-09-05T10:00:00Z"))).toBe("2026-09-05");
  });
});

describe("TransactionForm", () => {
  it("opens on today", () => {
    renderForm();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-05");
  });

  // The one typing slip worth designing against: a purchase entered as income
  // because a minus sign was never typed.
  it("sends a spend as a negative amount", async () => {
    const user = userEvent.setup();
    const { onSaved, onClose } = renderForm();

    await user.type(screen.getByLabelText("Montant (€)"), "12,50");
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.amount_cents).toBe(-1250);
    expect(body.label_raw).toBe("Boulangerie");
    expect(body.account_id).toBe(1);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends an income as a positive amount", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: "Recette" }));
    await user.type(screen.getByLabelText("Montant (€)"), "40");
    await user.type(screen.getByLabelText("Libellé"), "Remboursement");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[0]).amount_cents).toBe(4000);
  });

  it("sends no category when none was chosen, so the household's rules decide", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Montant (€)"), "9");
    await user.type(screen.getByLabelText("Libellé"), "NETFLIX.COM");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[0]).category_id).toBeNull();
  });

  it("writes the account the reader picked", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText("Compte"), "2");
    await user.type(screen.getByLabelText("Montant (€)"), "9");
    await user.type(screen.getByLabelText("Libellé"), "Virement");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[0]).account_id).toBe(2);
  });

  it("refuses to send an unreadable amount, and says why", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Montant (€)"), "douze");
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/montant/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a refusal from the server rather than closing on it", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      clone: () => ({ json: async () => ({ detail: "Compte introuvable" }) }),
      json: async () => ({ detail: "Compte introuvable" }),
    });
    const user = userEvent.setup();
    const { onClose } = renderForm();

    await user.type(screen.getByLabelText("Montant (€)"), "12");
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Compte introuvable");
    expect(onClose).not.toHaveBeenCalled();
  });

  // A date input hands over a value for every keystroke that parses, so the
  // first digit of a year is the year 2. Saving that wrote a transaction dated
  // 0002 and said nothing.
  it("refuses a half-typed year instead of saving the year it happens to parse as", async () => {
    const user = userEvent.setup();
    renderForm();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "0002-12-08" } });
    await user.type(screen.getByLabelText("Montant (€)"), "12");
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/date/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what to do when the household has no account at all", async () => {
    const user = userEvent.setup();
    renderForm({ accounts: [] });

    await user.type(screen.getByLabelText("Montant (€)"), "12");
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Réglages/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const existing: Transaction = {
  id: 42,
  account_id: 2,
  date: "2025-12-08",
  value_date: null,
  amount_cents: -1250,
  label_raw: "Boulangerie du coin",
  label_clean: "boulangerie du coin",
  category_id: 1,
  category_source: "manual",
  is_transfer: false,
  is_recurring: false,
  notes: "en espèces",
  tags: [],
  manual: true,
};

// The same drawer, pointed at a row that already exists. A ledger line can be
// wrong in ways no recategorisation reaches -- a date typed a month off, a
// debit entered as a credit -- and the way out has to be the same form that
// wrote it, or the two would drift apart field by field.
describe("TransactionForm, correcting a row that exists", () => {
  it("opens on the row's own values, not on today", () => {
    renderForm({ transaction: existing });

    expect(screen.getByLabelText("Date")).toHaveValue("2025-12-08");
    expect(screen.getByLabelText("Montant (€)")).toHaveValue("12,50");
    expect(screen.getByLabelText("Libellé")).toHaveValue("Boulangerie du coin");
    expect(screen.getByLabelText("Compte")).toHaveValue("2");
    expect(screen.getByLabelText("Note (facultative)")).toHaveValue("en espèces");
  });

  // The sign is read back the way it was written: a stored -1250 is "Dépense,
  // 12,50 €", never a minus sign in the amount field.
  it("reads a debit back as a spend", () => {
    renderForm({ transaction: existing });
    expect(screen.getByRole("radio", { name: "Dépense" })).toBeChecked();
  });

  it("reads a credit back as an income", () => {
    renderForm({ transaction: { ...existing, amount_cents: 4000 } });
    expect(screen.getByRole("radio", { name: "Recette" })).toBeChecked();
  });

  it("saves the correction onto the row itself", async () => {
    const user = userEvent.setup();
    const { onSaved, onClose } = renderForm({ transaction: existing });

    await user.clear(screen.getByLabelText("Libellé"));
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie Martin");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/transactions/42");
    expect(init.method).toBe("PATCH");
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.label_raw).toBe("Boulangerie Martin");
    expect(body.date).toBe("2025-12-08");
    expect(body.amount_cents).toBe(-1250);
    expect(body.account_id).toBe(2);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Sending the category back unchanged is not free: the backend reads any
  // category_id as a correction, learns a rule from it and backfills other
  // rows. Fixing a date must not reclassify a household's ledger.
  it("leaves the category out of a correction that did not touch it", async () => {
    const user = userEvent.setup();
    renderForm({ transaction: existing });

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty("category_id");
  });

  it("sends the category when the reader changes it", async () => {
    const user = userEvent.setup();
    renderForm({ transaction: { ...existing, category_id: null } });

    await user.click(screen.getByRole("combobox", { name: "Catégorie" }));
    await user.click(screen.getByRole("option", { name: "Alimentation" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[0]).category_id).toBe(1);
  });

  // On a new row an empty picker means "let the household's rules decide"; on
  // an existing one it means "this row has no category". The reset option in
  // the list says which of the two it is.
  it("offers to remove the category rather than to detect one", async () => {
    const user = userEvent.setup();
    renderForm({ transaction: existing });

    await user.click(screen.getByRole("combobox", { name: "Catégorie" }));

    expect(screen.getByRole("option", { name: "Aucune catégorie" })).toBeInTheDocument();
  });

  it("still offers to let the rules decide on a new row", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("combobox", { name: "Catégorie" }));

    expect(screen.getByRole("option", { name: "Détecter automatiquement" })).toBeInTheDocument();
  });

  it("names the drawer for what it does", () => {
    renderForm({ transaction: existing });
    expect(screen.getByText("Modifier une opération")).toBeInTheDocument();
  });
});
