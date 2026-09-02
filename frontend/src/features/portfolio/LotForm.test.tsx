import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { Lot } from "../../lib/types";
import { LotForm } from "./LotForm";

const LOTS: Lot[] = [
  {
    id: 1,
    position_id: 77,
    quantity: "12.000000000000000000",
    unit_cost_cents: 15_000,
    acquired_on: "2026-01-15",
  },
  {
    id: 2,
    position_id: 77,
    quantity: "3.000000000000000000",
    unit_cost_cents: 18_000,
    acquired_on: "2026-02-02",
  },
];

function renderForm(props: Partial<React.ComponentProps<typeof LotForm>> = {}) {
  return render(
    <LotForm
      positionId={77}
      symbol="AAPL"
      siblings={LOTS}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LotForm", () => {
  it("sends the quantity as text at its canonical scale, and the price as integer cents", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(LOTS[0]);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderForm({ onSaved });

    await user.type(screen.getByLabelText(/Quantité acquise/), "0,25");
    await user.type(screen.getByLabelText(/Prix unitaire payé/), "1 250,50");
    await user.type(screen.getByLabelText(/Date d'acquisition/), "2026-03-04");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/portfolio/lots", {
        position_id: 77,
        quantity: "0.250000000000000000",
        unit_cost_cents: 125_050,
        acquired_on: "2026-03-04",
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("refuses a nineteenth decimal in French rather than truncating it", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Quantité acquise/), "0,0000000000000000019");
    await user.type(screen.getByLabelText(/Prix unitaire payé/), "100");
    await user.type(screen.getByLabelText(/Date d'acquisition/), "2026-03-04");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Quantité trop précise : 19 décimales ont été saisies et Yieldo n'en conserve que 18. Aucune décimale n'est arrondie en silence : retirez-en 1.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantité acquise/)).toHaveAttribute("aria-invalid", "true");
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a quantity of zero with the reason that is true of it", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Quantité acquise/), "0");
    await user.type(screen.getByLabelText(/Prix unitaire payé/), "100");
    await user.type(screen.getByLabelText(/Date d'acquisition/), "2026-03-04");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "La quantité d'un lot doit être strictement positive : un lot est une acquisition, jamais une cession.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses an unreadable price at the price field, not at the quantity", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Quantité acquise/), "12");
    await user.type(screen.getByLabelText(/Prix unitaire payé/), "cent cinquante");
    await user.type(screen.getByLabelText(/Date d'acquisition/), "2026-03-04");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Prix illisible : saisissez le prix unitaire payé en euros, par exemple 150,00.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantité acquise/)).toHaveAttribute("aria-invalid", "false");
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a missing acquisition date, which no lot may be without", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Quantité acquise/), "12");
    await user.type(screen.getByLabelText(/Prix unitaire payé/), "150");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Date d'acquisition manquante : c'est elle qui datera la plus-value de ce lot, lot par lot.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows what the POSITION will hold, as the sum of its lots", async () => {
    // The whole point of the lot form: a position stores no total, so the
    // total is shown being derived — 12 + 3 already held, plus the 5 typed.
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(
      /AAPL détient aujourd'hui 15 unités, somme de ses 2 lots/,
    );

    await user.type(screen.getByLabelText(/Quantité acquise/), "5");
    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(
      /Après enregistrement, AAPL comptera 3 lots, soit 20 unités au total/,
    );
  });

  it("says the first lot is the first, rather than deriving a total from nothing", () => {
    renderForm({ siblings: [] });
    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(
      /AAPL ne compte encore aucun lot : celui-ci sera le premier/,
    );
  });

  it("adds fractions exactly, where a float would not", async () => {
    const user = userEvent.setup();
    renderForm({
      siblings: [{ ...LOTS[0], quantity: "0.100000000000000000" }],
    });

    await user.type(screen.getByLabelText(/Quantité acquise/), "0,2");
    // 0.1 + 0.2 through a JavaScript number is 0.30000000000000004.
    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(/soit 0,3 unité/);
  });

  it("says the total cannot be derived while the quantity is unreadable", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Quantité acquise/), "douze");
    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(
      /Le total ne peut pas être calculé tant que la quantité saisie n'est pas lisible/,
    );
  });

  it("states outright that no total is stored", () => {
    renderForm();
    expect(
      screen.getByText(/Yieldo ne stocke jamais ce total : il est recalculé à partir des lots/),
    ).toBeInTheDocument();
  });

  it("amends a lot through PATCH, prefilled and without counting it twice", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue(LOTS[0]);
    const user = userEvent.setup();
    renderForm({ lot: LOTS[0] });

    // The lot being amended is not also one of the lots it is added to: the
    // position holds 15 units, of which this lot is 12, so the other lots are 3.
    expect(screen.getByLabelText(/Quantité acquise/)).toHaveValue("12");
    expect(screen.getByLabelText(/Prix unitaire payé/)).toHaveValue("150,00");
    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(
      /AAPL comptera 2 lots, soit 15 unités/,
    );

    await user.clear(screen.getByLabelText(/Quantité acquise/));
    await user.type(screen.getByLabelText(/Quantité acquise/), "20");
    expect(screen.getByTestId("yd-lot-running-total")).toHaveTextContent(
      /AAPL comptera 2 lots, soit 23 unités/,
    );

    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/portfolio/lots/1", {
        quantity: "20.000000000000000000",
        unit_cost_cents: 15_000,
        acquired_on: "2026-01-15",
      });
    });
  });

  it("shows the backend's own refusal when it rejects the lot", async () => {
    const { ApiError } = await import("../../lib/api");
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(404, "Position introuvable."));
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Quantité acquise/), "12");
    await user.type(screen.getByLabelText(/Prix unitaire payé/), "150");
    await user.type(screen.getByLabelText(/Date d'acquisition/), "2026-03-04");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(await screen.findByText("Position introuvable.")).toBeInTheDocument();
  });
});
