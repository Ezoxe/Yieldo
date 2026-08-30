import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FeasibilityContext, FeasibilityRequest } from "../../lib/types";
import { PurchaseForm } from "./PurchaseForm";

/** The operator's own measured context, read off `GET /api/feasibility/context`
 *  against the seeded fixture. */
const CONTEXT: FeasibilityContext = {
  capacity: {
    months: 3,
    median_cents: -74_619,
    spread_cents: 213_078,
    low_cents: -347_690,
    high_cents: 198_452,
  },
  expense_rate: {
    months: 3,
    median_cents: 265_449,
    spread_cents: 221_457,
    low_cents: -18_360,
    high_cents: 549_258,
  },
  income_rate: {
    months: 3,
    median_cents: 47_111,
    spread_cents: 40_002,
    low_cents: -4_154,
    high_cents: 98_376,
  },
  months_observed: 3,
  history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
  balance_cents: -220_963,
  existing_debt_payments_cents: 0,
  assumptions: {
    annual_return_bps: 300,
    loan_rate_bps: 500,
    loan_months: 60,
    ownership_years: 5,
    monthly_income_cents: 47_111,
    existing_debt_payments_cents: 0,
  },
  natures: ["vehicle", "property", "other"],
  default_ownership_years: 5,
  default_annual_return_bps: 300,
};

function renderForm(over: Partial<Parameters<typeof PurchaseForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <PurchaseForm
      context={CONTEXT}
      busy={false}
      showLoa={false}
      onToggleLoa={vi.fn()}
      onSubmit={onSubmit}
      {...over}
    />,
  );
  return onSubmit;
}

/** The last request the form emitted. */
function sent(onSubmit: ReturnType<typeof vi.fn>): FeasibilityRequest {
  expect(onSubmit).toHaveBeenCalled();
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0] as FeasibilityRequest;
}

describe("PurchaseForm", () => {
  it("asks the operator's own question in integer cents", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.type(screen.getByLabelText(/Prix du bien/), "40000");
    await user.clear(screen.getByLabelText(/Échéance/));
    await user.type(screen.getByLabelText(/Échéance/), "12");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));

    const request = sent(onSubmit);
    expect(request.target_cents).toBe(4_000_000);
    expect(request.horizon_months).toBe(12);
    expect(request.down_payment_cents).toBe(0);
    expect(request.nature).toBe("vehicle");
  });

  it("prefills every hypothesis from the measured context and says they are hypotheses", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    // Design §10: the hypotheses are visible beside the result, so they are
    // visible beside the question too.
    await user.click(screen.getByRole("button", { name: /Hypothèses/ }));
    expect(screen.getByLabelText(/Rendement annuel/)).toHaveValue("3,00");
    expect(screen.getByLabelText(/Taux du crédit/)).toHaveValue("5,00");
    expect(screen.getByLabelText(/Durée du prêt/)).toHaveValue("60");
    expect(screen.getByLabelText(/Durée de possession/)).toHaveValue("5");

    await user.type(screen.getByLabelText(/Prix du bien/), "40000");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));

    // A rate travels as integer basis points, never as a float percentage.
    const request = sent(onSubmit);
    expect(request.annual_return_bps).toBe(300);
    expect(request.loan_rate_bps).toBe(500);
    expect(request.loan_months).toBe(60);
    expect(request.ownership_years).toBe(5);
  });

  it("reads an edited rate back as basis points, not as a float", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.click(screen.getByRole("button", { name: /Hypothèses/ }));
    await user.clear(screen.getByLabelText(/Taux du crédit/));
    await user.type(screen.getByLabelText(/Taux du crédit/), "4,35");
    await user.type(screen.getByLabelText(/Prix du bien/), "8000");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));

    expect(sent(onSubmit).loan_rate_bps).toBe(435);
  });

  it("refuses an unreadable price at the field rather than sending a zero", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/Prix du bien/), "quarante mille");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Montant illisible/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Prix du bien/)).toHaveAttribute("aria-invalid", "true");
  });

  it("refuses a price of zero, which has nothing to be feasible about", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/Prix du bien/), "0");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/strictement positif/)).toBeInTheDocument();
  });

  it("sends the LOA quote only once the user has entered one", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm({ showLoa: true });
    await user.type(screen.getByLabelText(/Prix du bien/), "40000");
    await user.type(screen.getByLabelText(/Premier loyer/), "5000");
    await user.type(screen.getByLabelText(/Loyer mensuel/), "450");
    await user.clear(screen.getByLabelText(/Durée de la LOA/));
    await user.type(screen.getByLabelText(/Durée de la LOA/), "48");
    await user.type(screen.getByLabelText(/Valeur de rachat/), "18000");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));

    expect(sent(onSubmit).loa).toEqual({
      deposit_cents: 500_000,
      monthly_cents: 45_000,
      months: 48,
      residual_cents: 1_800_000,
    });
  });

  it("omits the LOA entirely when its panel was never opened", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/Prix du bien/), "40000");
    await user.click(screen.getByRole("button", { name: /Calculer/ }));
    // `undefined`, not a zeroed quote: an invented LOA is exactly what
    // `levers._reason_no_loa_terms` refuses to do.
    expect(sent(onSubmit).loa).toBeUndefined();
  });

  it("disables the submit while a computation is in flight", () => {
    renderForm({ busy: true });
    expect(screen.getByRole("button", { name: /Calcul en cours/ })).toBeDisabled();
  });
});
