import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeasibilityRequest, Scenario } from "../../lib/types";
import { OPERATOR_REPORT } from "./fixtures";
import { ScenarioBar } from "./ScenarioBar";

const QUESTION: FeasibilityRequest = {
  target_cents: 4_000_000,
  horizon_months: 12,
  down_payment_cents: 0,
  nature: "vehicle",
};

/** Two scenarios whose RECOMPUTED answers differ, which is the whole reason a
 *  comparison table exists. */
const SCENARIOS: Scenario[] = [
  {
    id: 1,
    name: "Voiture 40 000 €",
    created_at: "2026-08-30T10:00:00Z",
    request: QUESTION,
    result: OPERATOR_REPORT,
  },
  {
    id: 2,
    name: "Voiture d'occasion",
    created_at: "2026-08-30T10:05:00Z",
    request: { ...QUESTION, target_cents: 1_500_000, horizon_months: 36 },
    result: {
      ...OPERATOR_REPORT,
      target_cents: 1_500_000,
      horizon_months: 36,
      verdict: "tight",
      gap_cents: -120_000,
      levers: OPERATOR_REPORT.levers.map((lever) =>
        lever.kind === "save_more" ? { ...lever, extra_monthly_cents: 91_500 } : lever,
      ),
    },
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

function renderBar(over: Partial<Parameters<typeof ScenarioBar>[0]> = {}) {
  const onChanged = vi.fn();
  const onReopen = vi.fn();
  render(
    <ScenarioBar
      scenarios={SCENARIOS}
      current={QUESTION}
      onChanged={onChanged}
      onReopen={onReopen}
      {...over}
    />,
  );
  return { onChanged, onReopen };
}

describe("ScenarioBar", () => {
  it("puts two recomputed verdicts side by side", () => {
    renderBar();
    expect(within(screen.getByTestId("yd-scenario-1")).getByText(/Hors de portée/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("yd-scenario-2")).getByText(/Atteignable en serrant/),
    ).toBeInTheDocument();
  });

  it("branches the gap on its sign, in each row", () => {
    renderBar();
    expect(within(screen.getByTestId("yd-scenario-1")).getByText(/48 954,28 . manquants/)).toBeInTheDocument();
    expect(within(screen.getByTestId("yd-scenario-2")).getByText(/1 200,00 . de marge/)).toBeInTheDocument();
  });

  it("never lets a saved row read as a saved answer", () => {
    renderBar();
    expect(screen.getByText(/garde la question, jamais la réponse/)).toBeInTheDocument();
    expect(screen.getByText(/recalculés sur vos relevés actuels/)).toBeInTheDocument();
  });

  it("says a verdict was not rendered rather than drawing a dash for it", () => {
    renderBar({
      scenarios: [
        {
          ...SCENARIOS[0],
          result: { ...OPERATOR_REPORT, verdict: null, gap_cents: null, levers: [] },
        },
      ],
    });
    expect(screen.getByText("Non rendu")).toBeInTheDocument();
  });

  it("saves the question that is currently on screen", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    const { onChanged } = renderBar();
    await user.type(screen.getByLabelText(/Nom de ce scénario/), "Ma voiture");
    await user.click(screen.getByRole("button", { name: /Enregistrer la question/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.name).toBe("Ma voiture");
    // The QUESTION, never the answer.
    expect(body.request).toEqual(QUESTION);
    expect(body.result).toBeUndefined();
  });

  it("cannot save before a question has been asked", () => {
    renderBar({ current: null });
    expect(screen.getByRole("button", { name: /Enregistrer la question/ })).toBeDisabled();
    expect(screen.getByText(/Posez d'abord une question/)).toBeInTheDocument();
  });

  it("asks before deleting, and deletes nothing on the first click", async () => {
    // Phase 2A shipped `Effacer l'indice` erasing a stored series on one
    // unconfirmed click; that defect was promoted into this plan rather than
    // deferred again.
    const user = userEvent.setup();
    const { onChanged } = renderBar();
    await user.click(screen.getByRole("button", { name: /Supprimer Voiture 40 000/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText(/Supprimer « Voiture 40 000 € » \?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("abandons a delete on Annuler", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: /Supprimer Voiture 40 000/ }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reopens a saved question in the form", async () => {
    const user = userEvent.setup();
    const { onReopen } = renderBar();
    await user.click(screen.getByRole("button", { name: "Voiture d'occasion" }));
    expect(onReopen).toHaveBeenCalledWith(SCENARIOS[1].request);
  });

  it("renders the server's own refusal rather than an alert", async () => {
    const user = userEvent.setup();
    const detail =
      "Vous ne pouvez pas enregistrer plus de 10 scénarios. Supprimez-en un pour en ajouter un autre.";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderBar();
    await user.type(screen.getByLabelText(/Nom de ce scénario/), "Un de trop");
    await user.click(screen.getByRole("button", { name: /Enregistrer la question/ }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing is saved rather than showing an empty table", () => {
    renderBar({ scenarios: [] });
    expect(screen.queryByTestId("yd-scenarios-table")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucun scénario enregistré/)).toBeInTheDocument();
  });
});
