import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { AllocationTarget } from "../../lib/types";
import { TargetsForm } from "./TargetsForm";

const TARGETS: AllocationTarget[] = [
  { id: 1, asset_class: "equity", target_bps: 6_000 },
  { id: 2, asset_class: "cash", target_bps: 4_000 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TargetsForm", () => {
  it("replaces the whole set in one PUT, as integer basis points", async () => {
    // Never a per-row patch: the 100 % invariant spans rows, so the set is the
    // unit of edit (`api/portfolio.replace_targets`).
    const put = vi.spyOn(api, "put").mockResolvedValue(TARGETS);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={onSaved} onCancel={vi.fn()} />);

    const shares = screen.getAllByLabelText(/Part visée/);
    await user.clear(shares[0]);
    await user.type(shares[0], "70");
    await user.clear(shares[1]);
    await user.type(shares[1], "30");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith("/portfolio/targets", {
        targets: [
          { asset_class: "equity", target_bps: 7_000 },
          { asset_class: "cash", target_bps: 3_000 },
        ],
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("reads a decimal share as basis points, never through a float", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue(TARGETS);
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const shares = screen.getAllByLabelText(/Part visée/);
    await user.clear(shares[0]);
    await user.type(shares[0], "62,50");
    await user.clear(shares[1]);
    await user.type(shares[1], "37,50");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith("/portfolio/targets", {
        targets: [
          { asset_class: "equity", target_bps: 6_250 },
          { asset_class: "cash", target_bps: 3_750 },
        ],
      });
    });
  });

  it("shows the running sum as the household types", async () => {
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId("yd-targets-sum")).toHaveTextContent("100,00 %");

    const shares = screen.getAllByLabelText(/Part visée/);
    await user.clear(shares[0]);
    await user.type(shares[0], "50");
    expect(screen.getByTestId("yd-targets-sum")).toHaveTextContent("90,00 %");
  });

  it("refuses a set that does not sum to 100 %, naming the sum and the gap", async () => {
    const put = vi.spyOn(api, "put");
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const shares = screen.getAllByLabelText(/Part visée/);
    await user.clear(shares[0]);
    await user.type(shares[0], "50");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "La somme des parts visées fait 90,00 %, alors qu'elle doit faire exactement 100,00 %. Ajoutez les 10,00 % manquants avant d'enregistrer.",
      ),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("says to remove the excess when the set sums above 100 %", async () => {
    const put = vi.spyOn(api, "put");
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const shares = screen.getAllByLabelText(/Part visée/);
    await user.clear(shares[0]);
    await user.type(shares[0], "75");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "La somme des parts visées fait 115,00 %, alors qu'elle doit faire exactement 100,00 %. Retirez les 15,00 % en trop avant d'enregistrer.",
      ),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses the same asset class twice, since a class carries one target", async () => {
    const put = vi.spyOn(api, "put");
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const classes = screen.getAllByLabelText(/Classe d'actifs/);
    await user.selectOptions(classes[1], "equity");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "La classe « Actions » porte deux cibles : une classe d'actifs n'en accepte qu'une seule.",
      ),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses an unreadable share at its own row", async () => {
    const put = vi.spyOn(api, "put");
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const shares = screen.getAllByLabelText(/Part visée/);
    await user.clear(shares[0]);
    await user.type(shares[0], "soixante");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Part illisible : saisissez un pourcentage, par exemple 60 ou 62,50.",
      ),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("adds and removes a class", async () => {
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Ajouter une classe/ }));
    expect(screen.getAllByLabelText(/Part visée/)).toHaveLength(3);

    await user.click(screen.getAllByRole("button", { name: /Retirer/ })[2]);
    expect(screen.getAllByLabelText(/Part visée/)).toHaveLength(2);
  });

  it("clears every target when the household removes them all", async () => {
    // An empty set is a legitimate payload: it means "I have declared no target
    // allocation", which is not the same thing as a set that sums wrong.
    const put = vi.spyOn(api, "put").mockResolvedValue([]);
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getAllByRole("button", { name: /Retirer/ })[1]);
    await user.click(screen.getAllByRole("button", { name: /Retirer/ })[0]);
    expect(
      screen.getByText(
        /Aucune classe : enregistrer maintenant efface votre allocation cible, et Yieldo cessera de mesurer l'écart/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/portfolio/targets", { targets: [] }));
  });

  it("starts a household that declared nothing on one empty row", () => {
    render(<TargetsForm targets={[]} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByLabelText(/Part visée/)).toHaveLength(1);
    expect(screen.getByTestId("yd-targets-sum")).toHaveTextContent("0,00 %");
  });

  it("shows the backend's own refusal when it rejects the set", async () => {
    const { ApiError } = await import("../../lib/api");
    vi.spyOn(api, "put").mockRejectedValue(new ApiError(422, "Classe d'actifs inconnue : gold"));
    const user = userEvent.setup();
    render(<TargetsForm targets={TARGETS} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));
    expect(await screen.findByText("Classe d'actifs inconnue : gold")).toBeInTheDocument();
  });
});
