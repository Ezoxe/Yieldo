import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FeasibilityContext, FeasibilityRequest } from "../../lib/types";
import { OWNERSHIP_DEFAULTS } from "./fixtures";
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
  ownership_defaults: OWNERSHIP_DEFAULTS,
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

describe("PurchaseForm — the running-cost items, prefilled and adjustable", () => {
  it("keeps the items collapsed until they are asked for", () => {
    renderForm();
    expect(screen.queryByLabelText(/Assurance/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Postes de fonctionnement/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("prefills one field per French average, in the unit that average uses", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));

    // A vehicle's three defaults are all flat monthly amounts.
    expect(screen.getByLabelText(/Assurance \(€ par mois\)/)).toHaveValue("65,00");
    expect(screen.getByLabelText(/Entretien et réparations \(€ par mois\)/)).toHaveValue("70,00");
    expect(screen.getByLabelText(/Carburant \(€ par mois\)/)).toHaveValue("130,00");
  });

  it("labels a percentage-of-value item as one, and never as euros", async () => {
    // `engines/ownership` charges taxe foncière and entretien on the asset's
    // REMAINING value each year. Exactly one of the two amounts is set on each
    // item, and the engine refuses both or neither — so the form has to keep
    // which one an item uses, not flatten everything to a monthly euro figure.
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/Nature du bien/), "property");
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));

    expect(screen.getByLabelText(/Taxe foncière \(% de la valeur par an\)/)).toHaveValue("0,90");
    expect(screen.getByLabelText(/Charges de copropriété \(€ par mois\)/)).toHaveValue("150,00");
    expect(screen.getByLabelText(/Entretien \(% de la valeur par an\)/)).toHaveValue("1,00");
  });

  it("sends the edited list back in the shape the engine accepts", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/Prix du bien/), "40000");
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));
    const fuel = screen.getByLabelText(/Carburant/);
    await user.clear(fuel);
    await user.type(fuel, "180,50");
    await user.click(screen.getByRole("button", { name: /Calculer la faisabilité/ }));

    const request = onSubmit.mock.calls[0][0] as FeasibilityRequest;
    expect(request.ownership_items).toEqual([
      { key: "insurance", label: "Assurance", monthly_cents: 6_500, annual_bps_of_value: null },
      {
        key: "maintenance",
        label: "Entretien et réparations",
        monthly_cents: 7_000,
        annual_bps_of_value: null,
      },
      { key: "fuel", label: "Carburant", monthly_cents: 18_050, annual_bps_of_value: null },
    ]);
  });

  it("keeps a percentage item a percentage on the way back out", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/Prix du bien/), "300000");
    await user.selectOptions(screen.getByLabelText(/Nature du bien/), "property");
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));
    const tax = screen.getByLabelText(/Taxe foncière/);
    await user.clear(tax);
    await user.type(tax, "1,20");
    await user.click(screen.getByRole("button", { name: /Calculer la faisabilité/ }));

    const request = onSubmit.mock.calls[0][0] as FeasibilityRequest;
    // 1,20 % is 120 basis points, and `monthly_cents` stays null: sending both
    // is a French 422 from the engine, and so is sending neither.
    expect(request.ownership_items?.[0]).toEqual({
      key: "property_tax",
      label: "Taxe foncière",
      monthly_cents: null,
      annual_bps_of_value: 120,
    });
  });

  it("swaps the items when the nature changes rather than keeping a car's", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));
    expect(screen.getByLabelText(/Carburant/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Nature du bien/), "property");
    expect(screen.queryByLabelText(/Carburant/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Charges de copropriété/)).toBeInTheDocument();
  });

  it("says so rather than showing an empty group when a nature prefills nothing", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/Nature du bien/), "other");
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));

    expect(screen.getByText(/Yieldo n'invente pas de moyenne/)).toBeInTheDocument();
  });

  it("refuses an unreadable amount in French rather than sending it as zero", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText(/Prix du bien/), "40000");
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));
    const fuel = screen.getByLabelText(/Carburant/);
    await user.clear(fuel);
    await user.type(fuel, "beaucoup");
    await user.click(screen.getByRole("button", { name: /Calculer la faisabilité/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Carburant/);
  });

  it("reopens a saved scenario's own items rather than the defaults", async () => {
    const user = userEvent.setup();
    renderForm({
      initial: {
        target_cents: 4_000_000,
        horizon_months: 12,
        down_payment_cents: 0,
        nature: "vehicle",
        ownership_items: [
          { key: "insurance", label: "Assurance", monthly_cents: 9_000, annual_bps_of_value: null },
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: /Postes de fonctionnement/ }));

    expect(screen.getByLabelText(/Assurance/)).toHaveValue("90,00");
    expect(screen.queryByLabelText(/Carburant/)).not.toBeInTheDocument();
  });
});
