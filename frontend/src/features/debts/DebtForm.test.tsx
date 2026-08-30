import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Debt } from "../../lib/types";
import { DebtForm } from "./DebtForm";

const EXISTING: Debt = {
  id: 7, name: "Auto", kind: "auto", principal_cents: 1_250_075, annual_rate_bps: 490,
  minimum_payment_cents: 25_000, term_months: 48, opened_on: "2024-03-01", archived: false,
};

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(EXISTING, 201));
  vi.stubGlobal("fetch", fetchMock);
});

describe("DebtForm", () => {
  it("sends euros as integer cents, never through a float", async () => {
    // 8,70 € through `parseFloat(x) * 100` is 869.9999999999999. The form uses
    // `parseCents`, which is string arithmetic end to end.
    const user = userEvent.setup();
    render(<DebtForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Découvert");
    await user.type(screen.getByLabelText(/Capital restant dû/), "8,70");
    await user.type(screen.getByLabelText(/Mensualité/), "8,70");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(body.principal_cents).toBe(870);
      expect(body.minimum_payment_cents).toBe(870);
    });
  });

  it("sends a percentage rate as integer basis points", async () => {
    const user = userEvent.setup();
    render(<DebtForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Carte");
    await user.type(screen.getByLabelText(/Capital restant dû/), "4500");
    await user.type(screen.getByLabelText(/Mensualité/), "120");
    await user.clear(screen.getByLabelText(/Taux annuel/));
    await user.type(screen.getByLabelText(/Taux annuel/), "19,90");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(body.annual_rate_bps).toBe(1990);
    });
  });

  it("reports an unreadable amount at the field, and sends nothing", async () => {
    const user = userEvent.setup();
    render(<DebtForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Prêt");
    await user.type(screen.getByLabelText(/Capital restant dû/), "douze mille");
    await user.type(screen.getByLabelText(/Mensualité/), "150");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    const field = await screen.findByLabelText(/Capital restant dû/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)).toHaveTextContent(/Montant illisible/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("patches an existing debt instead of creating a second one", async () => {
    const user = userEvent.setup();
    render(<DebtForm debt={EXISTING} onSaved={vi.fn()} onCancel={vi.fn()} />);

    // Pre-filled from the row, in euros and percent — 1 250 075 c is 12 500,75 €.
    expect(screen.getByLabelText(/Capital restant dû/)).toHaveValue("12500,75");
    expect(screen.getByLabelText(/Taux annuel/)).toHaveValue("4,90");

    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls[0][0]).toContain("/api/debts/7");
      expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    });
  });

  it("surfaces a backend rejection at the form, never silently", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Type de dette inconnu : bidon" }, 422));
    render(<DebtForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Prêt");
    await user.type(screen.getByLabelText(/Capital restant dû/), "1000");
    await user.type(screen.getByLabelText(/Mensualité/), "50");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(await screen.findByText(/Type de dette inconnu/)).toBeInTheDocument();
  });
});
