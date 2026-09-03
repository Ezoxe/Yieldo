import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { ApiError, api } from "../../lib/api";
import type { AlertReport } from "../../lib/types";
import { AlertsPage } from "./AlertsPage";
import { EMPTY_REPORT, OPERATOR_REPORT, REPORT_WITH_FLOOR } from "./fixtures";

/** Every body this render PUT, in order. */
let putted: Array<{ path: string; body: unknown }>;

function mockApi(reports: AlertReport[] = [OPERATOR_REPORT]) {
  putted = [];
  const queue = [...reports];
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    if (path !== "/alerts") throw new Error(`unexpected path ${path}`);
    return Promise.resolve((queue.length > 1 ? queue.shift() : queue[0]) as never);
  });
  vi.spyOn(api, "put").mockImplementation((path: string, body?: unknown) => {
    putted.push({ path, body });
    return Promise.resolve(undefined as never);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AlertsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AlertsPage — every alert says what, over what period, and what clears it", () => {
  it("prints the three claims as three labelled blocks, never as one paragraph", async () => {
    renderPage();
    const list = await screen.findByTestId("yd-alerts-list");
    const first = within(list).getAllByRole("listitem")[0];

    expect(within(first).getByText("Ce qui a été mesuré")).toBeInTheDocument();
    expect(within(first).getByText("Sur quelle période")).toBeInTheDocument();
    expect(within(first).getByText("Ce qui la lèverait")).toBeInTheDocument();

    expect(first).toHaveTextContent("236,55 € dans « Équipement et high-tech »");
    expect(first).toHaveTextContent("Opération du 28 décembre 2025");
    expect(first).toHaveTextContent("quittera le fil quand l'opération sortira de la fenêtre");
  });

  it("carries the severity as a WORD, not only as a colour", async () => {
    renderPage();
    const list = await screen.findByTestId("yd-alerts-list");
    for (const item of within(list).getAllByRole("listitem")) {
      expect(item).toHaveTextContent("Pour information");
    }
  });

  it("renders the amount through formatCents, with its own sign", async () => {
    renderPage();
    const list = await screen.findByTestId("yd-alerts-list");
    // The typographic minus formatCents emits, and the narrow no-break space.
    expect(within(list).getAllByRole("listitem")[0].textContent).toContain("−236,55");
  });

  it("gives each alert a stable key from the API rather than an index", async () => {
    renderPage();
    const list = await screen.findByTestId("yd-alerts-list");
    // Two anomalies on the SAME merchant: an index key would be the only thing
    // telling them apart, and reordering would then swap their contents.
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("28 décembre 2025");
    expect(items[1]).toHaveTextContent("13 février 2025");
  });
});

describe("AlertsPage — silence is an answer, not an empty screen", () => {
  it("shows all five conditions even when only one of them fired", async () => {
    renderPage();
    const conditions = await screen.findByTestId("yd-alerts-conditions");
    // Direct children only: a withheld subject is itself a <li> nested inside
    // its condition's card, and counting every listitem would report six.
    expect(conditions.children).toHaveLength(5);
    for (const kind of [
      "balance_floor",
      "missing_debit",
      "price_rise",
      "budget_crossed",
      "anomaly",
    ]) {
      expect(screen.getByTestId(`yd-cond-${kind}`)).toBeInTheDocument();
    }
  });

  it("tells a condition that was measured and found nothing from one nobody measured", async () => {
    renderPage();
    await screen.findByTestId("yd-alerts-conditions");

    expect(screen.getByTestId("yd-cond-price_rise")).toHaveTextContent(
      "Mesurée, rien à signaler",
    );
    // Measured, but a subject was set aside: NOT "rien à signaler", which
    // would contradict the refusal printed inside the very same card.
    expect(screen.getByTestId("yd-cond-missing_debit")).toHaveTextContent("1 sujet écarté");
    expect(screen.getByTestId("yd-cond-missing_debit")).not.toHaveTextContent(
      "rien à signaler",
    );
    expect(screen.getByTestId("yd-cond-budget_crossed")).toHaveTextContent("Non mesurée");
    expect(screen.getByTestId("yd-cond-budget_crossed")).toHaveTextContent(
      "Aucun budget mensuel n'est déclaré",
    );
    expect(screen.getByTestId("yd-cond-anomaly")).toHaveTextContent("2 alertes");
  });

  it("refuses to read an empty feed as « tout va bien »", async () => {
    mockApi([EMPTY_REPORT]);
    renderPage();
    const empty = await screen.findByTestId("yd-alerts-empty");
    expect(empty).toHaveTextContent("Ce n'est pas la même chose que « tout va bien »");
    expect(screen.getByTestId("yd-alerts-coverage")).toHaveTextContent(
      "Aucun relevé importé",
    );
  });
});

describe("AlertsPage — the import gap", () => {
  it("states the eight unimported months once, at the top, and lists them", async () => {
    renderPage();
    const gap = await screen.findByTestId("yd-alerts-gap");
    expect(gap).toHaveTextContent("8 mois de votre historique ne sont pas importés");
    expect(gap).toHaveTextContent("un trou dans les données, pas un événement");

    const months = screen.getByTestId("yd-alerts-missing");
    expect(within(months).getAllByRole("listitem")).toHaveLength(8);
    expect(months).toHaveTextContent("avril 2025");
    expect(months).toHaveTextContent("novembre 2025");
  });

  it("shows the withheld subject as a refusal, never as an alert", async () => {
    renderPage();
    await screen.findByTestId("yd-alerts-conditions");

    const withheld = screen.getByTestId("yd-cond-withheld-missing_debit");
    expect(withheld).toHaveTextContent("Un rythme n'est pas un prélèvement programmé");
    // And it is NOT in the alert feed, which is the whole point.
    const list = screen.getByTestId("yd-alerts-list");
    expect(list).not.toHaveTextContent("PHARMACIE CENTRALE");
  });

  it("says so plainly when a ledger has no gap at all", async () => {
    mockApi([
      {
        ...OPERATOR_REPORT,
        notice: null,
        coverage: { ...OPERATOR_REPORT.coverage, missing_months: [] },
      },
    ]);
    renderPage();
    await screen.findByTestId("yd-alerts-coverage");
    expect(screen.queryByTestId("yd-alerts-gap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("yd-alerts-missing")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucun trou/)).toBeInTheDocument();
  });
});

describe("AlertsPage — the threshold", () => {
  it("says an unset threshold is not a threshold of zero", async () => {
    renderPage();
    const rule = await screen.findByTestId("yd-alerts-floor-rule");
    expect(rule).toHaveTextContent("Un seuil non renseigné n'est pas un seuil à 0 €");
    expect(screen.getByTestId("yd-alerts-floor-state")).toHaveTextContent(
      "Aucun seuil enregistré",
    );
    // Nothing to clear when nothing is stored.
    expect(
      screen.queryByRole("button", { name: /Ne plus surveiller/ }),
    ).not.toBeInTheDocument();
  });

  it("stores a negative floor as integer cents", async () => {
    const user = userEvent.setup();
    mockApi([OPERATOR_REPORT, REPORT_WITH_FLOOR]);
    renderPage();

    await user.type(await screen.findByLabelText("Seuil (€)"), "-500");
    await user.click(screen.getByRole("button", { name: /Enregistrer le seuil/ }));

    await waitFor(() => expect(putted).toHaveLength(1));
    expect(putted[0]).toEqual({
      path: "/alerts/settings",
      body: { balance_floor_cents: -50000 },
    });
  });

  it("refuses an empty box in French rather than sending it as zero", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("Seuil (€)");
    await user.click(screen.getByRole("button", { name: /Enregistrer le seuil/ }));

    const error = await screen.findByTestId("yd-alerts-floor-error");
    expect(error).toHaveTextContent("Un champ vide n'est pas un seuil à 0 €");
    expect(putted).toHaveLength(0);
    expect(screen.getByLabelText("Seuil (€)")).toHaveAttribute("aria-invalid", "true");
  });

  it("refuses an unreadable amount rather than rounding it silently", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Seuil (€)"), "mille euros");
    await user.click(screen.getByRole("button", { name: /Enregistrer le seuil/ }));

    expect(await screen.findByTestId("yd-alerts-floor-error")).toHaveTextContent(
      "Montant illisible",
    );
    expect(putted).toHaveLength(0);
  });

  it("clears the floor back to « no floor » rather than to zero", async () => {
    const user = userEvent.setup();
    mockApi([REPORT_WITH_FLOOR, OPERATOR_REPORT]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Ne plus surveiller/ }));
    await waitFor(() => expect(putted).toHaveLength(1));
    expect(putted[0].body).toEqual({ balance_floor_cents: null });
    await waitFor(() =>
      expect(screen.getByTestId("yd-alerts-floor-state")).toHaveTextContent(
        "Aucun seuil enregistré",
      ),
    );
  });

  it("re-reads the whole report after a change, never patching the settings alone", async () => {
    const user = userEvent.setup();
    mockApi([OPERATOR_REPORT, REPORT_WITH_FLOOR]);
    renderPage();

    await user.type(await screen.findByLabelText("Seuil (€)"), "-500");
    await user.click(screen.getByRole("button", { name: /Enregistrer le seuil/ }));

    // The balance condition and the feed both change with the threshold: a
    // patched settings object would leave a stale sentence beside a new one.
    await waitFor(() =>
      expect(screen.getByTestId("yd-alert-balance_floor")).toHaveTextContent(
        "Le pire dixième de la projection (P10)",
      ),
    );
    expect(screen.getByTestId("yd-alert-balance_floor")).toHaveTextContent("Critique");
  });
});

describe("AlertsPage — failures", () => {
  it("shows a load failure as an alert rather than an empty screen", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(503, "Service indisponible."));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Service indisponible.");
  });

  it("raises no alert role at all when nothing failed", async () => {
    renderPage();
    await screen.findByTestId("yd-alerts-conditions");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
