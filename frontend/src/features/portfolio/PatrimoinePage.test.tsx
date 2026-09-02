import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import {
  DRIFTED_ALLOCATION,
  EMPTY_VALUATION,
  MIXED_VALUATION,
  NO_KEY_CONNECTIONS,
  NO_TARGETS_ALLOCATION,
} from "./fixtures";
import { PatrimoinePage } from "./PatrimoinePage";

function mockApi(valuation: unknown, allocation: unknown, connections: unknown) {
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    if (path === "/portfolio/valuation") return Promise.resolve(valuation);
    if (path === "/portfolio/allocation") return Promise.resolve(allocation);
    if (path === "/connections") return Promise.resolve(connections);
    throw new Error(`unexpected path ${path}`);
  });
}

beforeEach(() => {
  // 2026-08-12 is the fixture's own "today" — the stale price is 7 days old
  // against it, and an age asserted below has to be measured from somewhere
  // fixed or it changes every time the suite runs.
  //
  // `shouldAdvanceTime` is not optional here: Testing Library's `findBy*`
  // polls on a real timer, and freezing the clock outright deadlocks every
  // one of them. This pins the DATE while letting timers still tick.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-12T14:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PatrimoinePage — the operator's own state: no position, no key", () => {
  beforeEach(() => {
    mockApi(EMPTY_VALUATION, NO_TARGETS_ALLOCATION, NO_KEY_CONNECTIONS);
  });

  it("says what to declare instead of showing a hero zero", async () => {
    render(<PatrimoinePage />);
    await screen.findByText("Aucune position déclarée.");

    // A display-size "0,00 €" above "0 sur 0" is a true figure that tells a
    // household starting out nothing. The diagnosis replaces it.
    expect(screen.queryByTestId("yd-portfolio-total-amount")).not.toBeInTheDocument();

    // The three things a position actually needs, named.
    expect(screen.getByText(/Un compte d'investissement/)).toBeInTheDocument();
    expect(screen.getByText(/Un instrument/)).toBeInTheDocument();
    expect(screen.getByText(/Un lot par acquisition/)).toBeInTheDocument();
  });

  it("states the absence once, not once per panel", () => {
    // Two panels each saying "nothing is declared" is the same fact printed
    // twice — and the cell holding only that stretched to its neighbour's
    // height in the browser, leaving a tall empty box at 1440.
    render(<PatrimoinePage />);
    return screen.findByText("Aucune position déclarée.").then(() => {
      expect(screen.queryByText(/Rien à afficher tant qu'aucune position/)).not.toBeInTheDocument();
      expect(screen.getAllByText(/Aucune position déclarée/)).toHaveLength(1);
      // And no "Valeur du portefeuille" cell at all when there is nothing to
      // value — not an empty one.
      expect(screen.queryByText("Valeur du portefeuille")).not.toBeInTheDocument();
    });
  });

  it("says no key is registered without claiming a price went missing", async () => {
    render(<PatrimoinePage />);
    const panel = await screen.findByTestId("yd-market-no-key");
    expect(panel).toHaveTextContent(/Aucune clé n'est enregistrée pour l'instant/);

    // The four other causes name failures that did NOT happen here. Printing
    // any of them would send the operator to fix the wrong thing.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/refusée/);
    expect(body).not.toMatch(/quota.{0,20}épuisé/i);
    expect(body).not.toMatch(/injoignable/);
    expect(body).not.toMatch(/symbole.{0,10}inconnu/i);
  });

  it("says the application still works without a key", async () => {
    render(<PatrimoinePage />);
    const panel = await screen.findByTestId("yd-market-no-key");
    expect(panel).toHaveTextContent(/fonctionne sans aucune clé/);
  });

  it("distinguishes a provider needing no key from one whose key is missing", async () => {
    render(<PatrimoinePage />);
    // Frankfurter requires none — calling it "Aucune clé" would read as a
    // problem the operator could fix, and there is nothing to fix.
    const frankfurter = await screen.findByTestId("yd-provider-frankfurter");
    expect(frankfurter).toHaveTextContent("Aucune clé requise");
    expect(screen.getByTestId("yd-provider-finnhub")).toHaveTextContent("Aucune clé");
    expect(screen.getByTestId("yd-provider-finnhub")).not.toHaveTextContent("Aucune clé requise");
  });

  it("reports no target allocation as a refusal, not as an empty drift table", async () => {
    render(<PatrimoinePage />);
    const refusal = await screen.findByTestId("yd-allocation-refusal");
    expect(refusal).toHaveTextContent(/Aucune allocation cible n'est définie/);
    // A table of zeroes would be a measurement nobody made.
    expect(screen.queryByTestId("yd-drift-equity")).not.toBeInTheDocument();
  });
});

describe("PatrimoinePage — a populated portfolio", () => {
  beforeEach(() => {
    mockApi(MIXED_VALUATION, DRIFTED_ALLOCATION, NO_KEY_CONNECTIONS);
  });

  it("never renders the total without the completeness count beside it", async () => {
    render(<PatrimoinePage />);
    await screen.findByTestId("yd-portfolio-total-amount");
    // The backend bundles the two so a screen cannot show one alone.
    expect(screen.getByTestId("yd-portfolio-completeness")).toHaveTextContent(
      "2 positions valorisées sur 3.",
    );
  });

  it("says the total is a floor when something could not be valued", async () => {
    render(<PatrimoinePage />);
    const incomplete = await screen.findByTestId("yd-portfolio-incomplete");
    expect(incomplete).toHaveTextContent(/1 position n'a pas de prix/);
    expect(incomplete).toHaveTextContent(/un plancher, pas la valeur du portefeuille/);
  });

  it("draws a missing price as an absence, with no numeral standing in for it", async () => {
    render(<PatrimoinePage />);
    const row = await screen.findByTestId("yd-holding-MC.PA");
    expect(within(row).getByTestId("yd-holding-absent-MC.PA")).toHaveTextContent(
      "Prix indisponible",
    );
    // Not zero, and not the cost basis: the value cell carries no figure.
    expect(within(row).queryByTestId("yd-holding-value-MC.PA")).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent("0,00 €");
  });

  it("prints the missing price's own cause verbatim", async () => {
    render(<PatrimoinePage />);
    const reason = await screen.findByTestId("yd-holding-reason-MC.PA");
    expect(reason).toHaveTextContent(/Aucune clé n'est enregistrée pour Finnhub/);
    expect(reason).toHaveTextContent(/Réglages → Connexions/);
  });

  it("counts a stale price in the total and shows its age instead", async () => {
    render(<PatrimoinePage />);
    const row = await screen.findByTestId("yd-holding-BTC");
    // A real value, summed — the opposite of the missing row above.
    expect(within(row).getByTestId("yd-holding-value-BTC")).toHaveTextContent("10 000,00 €");
    expect(within(row).getByTestId("yd-holding-stale-BTC")).toHaveTextContent(
      /Prix daté du 5 août 2026, relevé il y a 7 jours/,
    );
    // And it is NOT drawn as an absence.
    expect(within(row).queryByTestId("yd-holding-absent-BTC")).not.toBeInTheDocument();
  });

  it("draws the three price states as three distinct shapes", async () => {
    render(<PatrimoinePage />);
    await screen.findByTestId("yd-holding-AAPL");
    // Fresh: a price and no qualifier at all.
    expect(screen.queryByTestId("yd-holding-stale-AAPL")).not.toBeInTheDocument();
    expect(screen.queryByTestId("yd-holding-absent-AAPL")).not.toBeInTheDocument();
    // Stale: qualified, not absent.
    expect(screen.getByTestId("yd-holding-stale-BTC")).toBeInTheDocument();
    expect(screen.queryByTestId("yd-holding-absent-BTC")).not.toBeInTheDocument();
    // Missing: absent, not qualified.
    expect(screen.getByTestId("yd-holding-absent-MC.PA")).toBeInTheDocument();
    expect(screen.queryByTestId("yd-holding-stale-MC.PA")).not.toBeInTheDocument();
  });

  it("renders a quantity from its string, never through a money formatter", async () => {
    render(<PatrimoinePage />);
    const row = await screen.findByTestId("yd-holding-BTC");
    // 0,25 BTC. Through formatCents this would read "0,00 €"; through a naive
    // Number() it would lose precision. And it carries no currency.
    expect(row).toHaveTextContent("0,25");
    expect(within(row).getByText("0,25")).toBeInTheDocument();
  });

  it("says the weights are over what could be valued, not over everything", async () => {
    render(<PatrimoinePage />);
    const basis = await screen.findByTestId("yd-weights-basis-asset_class");
    expect(basis).toHaveTextContent(/calculées sur ce qui a pu être valorisé/);
    expect(basis).toHaveTextContent(/elle n'y compte pas pour zéro/);
  });

  it("prints a sub-unit drift as the engine's refusal, never as a zero-unit order", async () => {
    render(<PatrimoinePage />);
    const refusal = await screen.findByTestId("yd-refusal-equity");
    expect(refusal).toHaveTextContent(/« AAPL » n'est pas fractionnable/);
    expect(refusal).toHaveTextContent(/moins d'une unité au prix actuel/);
    // No order was proposed for it.
    expect(screen.queryByTestId("yd-trade-AAPL")).not.toBeInTheDocument();
  });

  it("sizes the order it could size, in units and not in cents", async () => {
    render(<PatrimoinePage />);
    const trade = await screen.findByTestId("yd-trade-BTC");
    expect(trade).toHaveTextContent("Vendre");
    expect(within(trade).getByTestId("yd-trade-qty-BTC")).toHaveTextContent("0,0013125 unité");
    expect(trade).toHaveTextContent("≈ 52,50 €");
  });

  it("shows each class's current share against its target on one track", async () => {
    render(<PatrimoinePage />);
    const drift = await screen.findByTestId("yd-drift-crypto");
    expect(within(drift).getByTestId("yd-drift-current-crypto")).toHaveTextContent("86,96 %");
    expect(drift).toHaveTextContent("cible 86,50 %");
    expect(drift).toHaveTextContent(/Surpondérée/);
  });

  it("says the allocation was measured over the valued subset only", async () => {
    render(<PatrimoinePage />);
    const basis = await screen.findByTestId("yd-allocation-basis");
    expect(basis).toHaveTextContent("2 positions valorisées sur 3");
    expect(basis).toHaveTextContent(/n'est pas comptée comme valant zéro/);
  });
});

describe("PatrimoinePage — failures", () => {
  it("keeps the portfolio when only the connections read fails", async () => {
    vi.spyOn(api, "get").mockImplementation((path: string) => {
      if (path === "/portfolio/valuation") return Promise.resolve(MIXED_VALUATION);
      if (path === "/portfolio/allocation") return Promise.resolve(DRIFTED_ALLOCATION);
      return Promise.reject(new Error("boom"));
    });

    render(<PatrimoinePage />);
    // The holdings survive; only the market panel says it could not be read.
    await screen.findByTestId("yd-holdings-table");
    await waitFor(() =>
      expect(screen.getByText(/L'état des connexions n'a pas pu être lu/)).toBeInTheDocument(),
    );
  });

  it("reports a failed valuation as an alert, not as an empty portfolio", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("boom"));
    render(<PatrimoinePage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Patrimoine indisponible/);
    // An empty state here would claim the household holds nothing, which is a
    // different fact from "the server did not answer".
    expect(screen.queryByText("Aucune position déclarée.")).not.toBeInTheDocument();
  });
});
