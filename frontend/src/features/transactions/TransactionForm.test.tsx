import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, Category } from "../../lib/types";
import { parseAmountToCents, TransactionForm, todayIso } from "./TransactionForm";

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
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <TransactionForm
      open
      onClose={onClose}
      accounts={accounts}
      categories={categories}
      onCreated={onCreated}
      today={new Date("2026-09-05T10:00:00Z")}
      {...props}
    />,
  );
  return { onCreated, onClose };
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
    const { onCreated, onClose } = renderForm();

    await user.type(screen.getByLabelText("Montant (€)"), "12,50");
    await user.type(screen.getByLabelText("Libellé"), "Boulangerie");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.amount_cents).toBe(-1250);
    expect(body.label_raw).toBe("Boulangerie");
    expect(body.account_id).toBe(1);
    expect(onCreated).toHaveBeenCalled();
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
