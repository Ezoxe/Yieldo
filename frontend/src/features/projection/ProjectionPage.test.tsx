import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { api } from "../../lib/api";
import type { Projection } from "../../lib/types";
import { OPERATOR_PROJECTION, RICH_PROJECTION } from "./fixtures";
import { ProjectionPage } from "./ProjectionPage";

/** Every `GET /projection` this render makes, in order, so a test can assert
 *  WHAT was asked for — the seed above all. */
let requests: Array<Record<string, unknown>>;

function mockApi(body: Projection | Error = OPERATOR_PROJECTION) {
  requests = [];
  vi.spyOn(api, "get").mockImplementation((path: string, params?: Record<string, unknown>) => {
    if (path !== "/projection") throw new Error(`unexpected path ${path}`);
    requests.push(params ?? {});
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body);
  });
}

/** The address bar, rendered. This screen puts the whole run in the URL so a
 *  copied link redraws the identical band, and that promise is only testable
 *  if the test can read the location back. */
function LocationProbe() {
  return <span data-testid="yd-location">{useLocation().search}</span>;
}

function search(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("yd-location").textContent ?? "");
}

function renderPage(entry = "/projection") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider>
        <ProjectionPage />
        <LocationProbe />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

// `matchMedia` is stubbed once, globally, in `src/test-setup.ts` -- NOT here.
// This file used to redefine it per-test with a bare `vi.fn()`, which
// `vi.restoreAllMocks()` below resets to a no-op returning `undefined`
// between tests. Under load, a passive effect from `useReducedMotion` could
// still be flushing when that reset had already run, throwing
// `TypeError: Cannot read properties of undefined (reading 'addEventListener')`
// on whichever test happened to be executing -- intermittent, and clean on a
// re-run. The global stub is a plain function no mock lifecycle ever resets,
// which is what actually closes the race; jsdom genuinely has no
// `ResizeObserver` of its own, so `Chart.tsx`'s `typeof ResizeObserver !==
// "undefined"` guard is already false without stubbing it here too.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the seed", () => {
  it("is chosen visibly, written into the URL, and sent to the API", async () => {
    // `/api/projection` requires a seed and refuses to generate one. The screen
    // picks the first one, but never behind the reader's back: it lands in the
    // address bar and on the panel at the same moment.
    mockApi();
    renderPage();

    await screen.findByTestId("yd-projection-seed");
    const seedInUrl = search().get("graine");
    expect(seedInUrl).not.toBeNull();
    expect(requests[0].seed).toBe(Number(seedInUrl));
  });

  it("takes the seed from the URL when one is already there", async () => {
    mockApi();
    renderPage("/projection?graine=987654");
    await screen.findByTestId("yd-projection-seed");
    expect(requests[0].seed).toBe(987654);
  });

  it("prints the seed the API actually ran with, not the one that was asked for", async () => {
    // The panel echoes `assumptions.seed` off the response. If the two ever
    // disagreed, what is on screen must be what produced the figures.
    mockApi();
    renderPage("/projection?graine=1");
    expect(await screen.findByTestId("yd-projection-seed")).toHaveTextContent("424242");
  });

  it("re-runs with a different seed on the button, and says so in the URL", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage("/projection?graine=111");
    await screen.findByTestId("yd-projection-seed");

    await user.click(screen.getByRole("button", { name: "Nouvelle graine" }));

    await waitFor(() => expect(requests.length).toBeGreaterThan(1));
    const next = Number(search().get("graine"));
    expect(next).not.toBe(424_242);
    expect(requests[requests.length - 1].seed).toBe(next);
  });
});

describe("the operator's own screen: four refusals", () => {
  it("prints each engine's refusal verbatim, and never a zero in its place", async () => {
    mockApi();
    renderPage();

    const mc = await screen.findByTestId("yd-mc-refusal");
    expect(mc).toHaveTextContent("Aucun capital de départ");
    expect(screen.getByTestId("yd-tax-refusal")).toHaveTextContent("Aucune plus-value latente");
    expect(screen.getByTestId("yd-fire-timeline")).toHaveTextContent("recule ou stagne");
    expect(screen.getByTestId("yd-fire-drawdown")).toHaveTextContent(
      "votre capital constitué est de 0 €",
    );
    expect(screen.getByText(/Aucune classe d'actifs à soumettre à un choc/)).toBeInTheDocument();
  });

  it("shows four DIFFERENT sentences, never one repeated four times", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("yd-mc-refusal");

    const sentences = [
      screen.getByTestId("yd-mc-refusal").textContent,
      screen.getByTestId("yd-tax-refusal").textContent,
      within(screen.getByTestId("yd-fire-timeline")).getByText(/recule ou stagne/).textContent,
      screen.getByText(/Aucune classe d'actifs à soumettre à un choc/).textContent,
    ];
    expect(new Set(sentences).size).toBe(4);
  });

  it("keeps the measured capacity negative, with no abs() and no clamp", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("yd-projection-seed");
    // −746,19 €, with the typographic minus `formatCents` emits.
    expect(screen.getAllByText(/−746,19/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\+746,19/)).toBeNull();
  });

  it("still answers what it can: the FIRE target capital is a real figure", async () => {
    // A refusal on the timeline is not a refusal on everything. The expense
    // rate IS measured, so the capital the 4 % rule implies is shown.
    mockApi();
    renderPage();
    await screen.findByTestId("yd-projection-seed");
    expect(screen.getByText(/796 347,00/)).toBeInTheDocument();
  });

  it("still names the three episodes with their periods and their sources", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("yd-projection-seed");

    expect(screen.getByText("Crise financière de 2008")).toBeInTheDocument();
    expect(screen.getByText(/octobre 2007 - mars 2009/)).toBeInTheDocument();
    // Twice on the 2022 card: once as the period, once inside the citation.
    expect(screen.getAllByText(/année civile 2022/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MSCI World/).length).toBe(3);
    // And each is marked as a measured past on its own card, not once at the top.
    expect(screen.getAllByText("Épisode mesuré — pas une prévision")).toHaveLength(3);
  });
});

describe("the populated screen", () => {
  it("shows the band as three centiles and never as one number", async () => {
    mockApi(RICH_PROJECTION);
    renderPage();
    await screen.findByTestId("yd-projection-seed");

    expect(screen.getByText("Pire dixième (P10)")).toBeInTheDocument();
    expect(screen.getByText("Médiane (P50)")).toBeInTheDocument();
    expect(screen.getByText("Meilleur dixième (P90)")).toBeInTheDocument();
    // The negative lower centile is shown as the exhaustion it is.
    expect(screen.getByText(/−6 400,00/)).toBeInTheDocument();
    expect(screen.getAllByText(/le capital est épuisé/).length).toBeGreaterThan(0);
  });

  it("names the regime beside every tax figure, and shows none where there is no regime", async () => {
    mockApi(RICH_PROJECTION);
    renderPage();
    await screen.findByTestId("yd-projection-seed");

    expect(screen.getByTestId("yd-tax-regime-1")).toHaveTextContent("art. 157, 5° bis CGI");
    expect(screen.getByTestId("yd-tax-regime-2")).toHaveTextContent("PFU");
    // The PER carries no regime AND no figure -- the two are never separated.
    expect(screen.queryByTestId("yd-tax-regime-3")).toBeNull();
    expect(screen.getByText(/Yieldo ne calcule pas la fiscalité d'un PER/)).toBeInTheDocument();
    // The barème, priced beside the PFU rather than instead of it.
    expect(screen.getByText("Si vous optiez pour le barème")).toBeInTheDocument();
    expect(screen.getByTestId("yd-tax-cheaper")).toHaveTextContent("au PFU");
  });

  it("marks each stress scenario as a measured past and names what it could not test", async () => {
    mockApi(RICH_PROJECTION);
    renderPage();
    await screen.findByTestId("yd-projection-seed");

    const crisis = screen.getByTestId("yd-shock-2008");
    expect(crisis).toHaveTextContent("Épisode mesuré — pas une prévision");
    expect(crisis).toHaveTextContent("octobre 2007 - mars 2009");
    expect(crisis).toHaveTextContent("Bloomberg US Aggregate Bond Index");
    // Bitcoin did not exist in 2008: named as an absence, never counted at 0 %.
    expect(within(crisis).getByText("Aucune donnée")).toBeInTheDocument();
    expect(screen.getByTestId("yd-shock-untested-2008")).toHaveTextContent("Cryptomonnaies");
    // 2020 DOES have a Bitcoin figure, so the two cards must differ.
    expect(screen.queryByTestId("yd-shock-untested-2020")).toBeNull();
  });

  it("names the regime that taxed the retirement drawdown", async () => {
    mockApi(RICH_PROJECTION);
    renderPage();
    await screen.findByTestId("yd-projection-seed");
    expect(screen.getByTestId("yd-fire-drawdown")).toHaveTextContent(
      "Régime appliqué : barème progressif à 30,00 %",
    );
  });

  it("reports the timeline in years and months, with the assumptions beside it", async () => {
    mockApi(RICH_PROJECTION);
    renderPage();
    await screen.findByTestId("yd-projection-seed");
    const timeline = screen.getByTestId("yd-fire-timeline");
    expect(timeline).toHaveTextContent("31 ans et 1 mois");
    expect(timeline).toHaveTextContent("3,00 %");
  });

  it("says how much of the portfolio it could actually value", async () => {
    mockApi(RICH_PROJECTION);
    renderPage();
    await screen.findByTestId("yd-projection-seed");
    expect(screen.getByText(/2 positions valorisées sur 3/)).toBeInTheDocument();
    expect(screen.getByText(/plancher, pas la valeur de votre patrimoine/)).toBeInTheDocument();
  });
});

describe("the assumptions form", () => {
  it("re-runs with what was typed, and puts it in the URL", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage("/projection?graine=7");
    await screen.findByTestId("yd-projection-seed");

    await user.click(screen.getByRole("button", { name: "Modifier les hypothèses" }));
    const horizon = screen.getByLabelText("Horizon (mois)");
    await user.clear(horizon);
    await user.type(horizon, "120");
    await user.click(screen.getByRole("button", { name: "Relancer la projection" }));

    await waitFor(() => expect(requests[requests.length - 1].months).toBe(120));
    expect(search().get("horizon")).toBe("120");
  });

  it("refuses an impossible horizon in French, before the round trip", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage("/projection?graine=7");
    await screen.findByTestId("yd-projection-seed");
    const before = requests.length;

    await user.click(screen.getByRole("button", { name: "Modifier les hypothèses" }));
    const horizon = screen.getByLabelText("Horizon (mois)");
    await user.clear(horizon);
    await user.type(horizon, "9000");
    await user.click(screen.getByRole("button", { name: "Relancer la projection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("entre 1 et 600");
    expect(requests.length).toBe(before);
  });

  it("keeps an empty marginal rate out of the request entirely, never as a zero", async () => {
    // Empty means "do not price the barème". 0 % is a real, very low bracket.
    mockApi();
    renderPage("/projection?graine=7");
    await screen.findByTestId("yd-projection-seed");
    expect(requests[0].marginal_rate_bps).toBeNull();
    expect(screen.getByText("Non renseigné")).toBeInTheDocument();
  });
});

describe("failure", () => {
  it("shows a load failure as an alert, never as a panel refusal", async () => {
    mockApi(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Projection indisponible");
  });
});
