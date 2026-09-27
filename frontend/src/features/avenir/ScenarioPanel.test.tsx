import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Outlook } from "../../lib/types";
import { OUTLOOK } from "./fixtures";
import { ScenarioPanel } from "./ScenarioPanel";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WORSE: Outlook = {
  ...OUTLOOK,
  low_point: { on: "2026-10-27", p50_cents: -34_000, p10_cents: -50_000 },
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/outlook/scenario") {
      return Promise.resolve(json({ base: OUTLOOK, scenario: WORSE }));
    }
    return Promise.resolve(json({ id: 3 }, 201));
  });
  vi.stubGlobal("fetch", fetchMock);
});

function renderPanel(overrides: Partial<Parameters<typeof ScenarioPanel>[0]> = {}) {
  const props = {
    outlook: OUTLOOK, scope: "checking" as const, horizonDays: 90,
    onScenario: vi.fn(), onSaved: vi.fn(), ...overrides,
  };
  render(<ScenarioPanel {...props} />);
  return props;
}

function scenarioBodies() {
  return fetchMock.mock.calls
    .filter(([input]) => String(input) === "/api/outlook/scenario")
    .map(([, init]) => JSON.parse(init.body));
}

describe("ScenarioPanel", () => {
  it("adds a one-off expense and says what it does to the low point", async () => {
    const props = renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Dépense ponctuelle" }));
    await user.type(screen.getByLabelText("Libellé"), "Vacances");
    // The date opens on the day after the statements; replace it.
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-10-20");
    await user.type(screen.getByLabelText("Montant (€)"), "1800");
    await user.click(screen.getByRole("button", { name: "Ajouter au scénario" }));

    await waitFor(() => expect(scenarioBodies()).toHaveLength(1));
    expect(scenarioBodies()[0]).toEqual({
      scope: "checking", horizon_days: 90,
      adjustments: [{ kind: "one_off", on: "2026-10-20", label: "Vacances", amount_cents: -180000 }],
    });
    expect(await screen.findByText(/Avec ce scénario : point bas −340,00 € le 27 octobre/)).toBeInTheDocument();
    expect(props.onScenario).toHaveBeenLastCalledWith(WORSE);
  });

  it("cancels a series chosen from what is projected", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Résilier…" }));
    await user.selectOptions(screen.getByLabelText("Échéance"), "detected:prlv sepa foncia loyer");
    await user.click(screen.getByRole("button", { name: "Ajouter au scénario" }));

    await waitFor(() => expect(scenarioBodies()).toHaveLength(1));
    expect(scenarioBodies()[0].adjustments[0]).toMatchObject({
      kind: "cancel", series: "detected:prlv sepa foncia loyer",
    });
  });

  it("forgets the scenario when its last change is removed", async () => {
    const props = renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dépense ponctuelle" }));
    await user.type(screen.getByLabelText("Libellé"), "Vacances");
    // The date opens on the day after the statements; replace it.
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-10-20");
    await user.type(screen.getByLabelText("Montant (€)"), "1800");
    await user.click(screen.getByRole("button", { name: "Ajouter au scénario" }));
    await screen.findByText(/Avec ce scénario/);

    await user.click(screen.getByRole("button", { name: "Retirer Vacances du scénario" }));

    await waitFor(() => expect(props.onScenario).toHaveBeenLastCalledWith(null));
  });

  it("keeps a one-off change as a planned event", async () => {
    const props = renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dépense ponctuelle" }));
    await user.type(screen.getByLabelText("Libellé"), "Vacances");
    // The date opens on the day after the statements; replace it.
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-10-20");
    await user.type(screen.getByLabelText("Montant (€)"), "1800");
    await user.click(screen.getByRole("button", { name: "Ajouter au scénario" }));
    await screen.findByText(/Avec ce scénario/);

    await user.click(screen.getByRole("button", { name: "Enregistrer Vacances comme événement prévu" }));

    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    const planned = fetchMock.mock.calls.find(([input]) => String(input) === "/api/planned-events");
    expect(JSON.parse(planned?.[1].body)).toEqual({
      label: "Vacances", due_on: "2026-10-20", amount_cents: -180000,
    });
  });
});
