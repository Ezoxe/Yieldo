import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Category, Engagement } from "../../lib/types";
import { SuiviPage } from "./SuiviPage";
import { OPERATOR_ENGAGEMENT } from "./fixtures";

const LOISIRS: Category = {
  id: 38,
  parent_id: null,
  name: "Loisirs",
  slug: "loisirs",
  kind: "expense",
  color: "#7ee2d6",
  icon: "",
  monthly_budget_cents: null,
  is_essential: false,
};

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Overrides {
  engagement?: () => Response;
  categories?: () => Response;
  onDecide?: (path: string) => Response;
}

function setupFetch(body: Engagement = OPERATOR_ENGAGEMENT, overrides: Overrides = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (url.pathname.startsWith("/api/engagement/challenges/") && method === "POST") {
      return Promise.resolve(
        overrides.onDecide ? overrides.onDecide(url.pathname) : jsonResponse({}),
      );
    }
    if (url.pathname === "/api/engagement") {
      return Promise.resolve(overrides.engagement ? overrides.engagement() : jsonResponse(body));
    }
    if (url.pathname === "/api/categories") {
      return Promise.resolve(
        overrides.categories ? overrides.categories() : jsonResponse([LOISIRS]),
      );
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/suivi"]}>
      <ThemeProvider>
        <SuiviPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("SuiviPage — the operator's own state", () => {
  it("shows the four mechanics, each answering from his own ledger", async () => {
    setupFetch();
    renderPage();

    // The streak, broken for seven months — the engine's sentence verbatim.
    expect(
      await screen.findByText(/cela fait 7 mois qu'aucun relevé n'a été importé/),
    ).toBeInTheDocument();
    // The health score, MEASURED at zero.
    expect(screen.getByTestId("yd-health-score")).toHaveTextContent("0");
    // Three of four components measured; the fourth is an absence, not a bar.
    expect(screen.getAllByRole("meter")).toHaveLength(3);
    expect(screen.getByText("Non mesurée")).toBeInTheDocument();
    // No goals declared, so the milestone panel diagnoses rather than blanks.
    expect(screen.getByText(/Aucun objectif déclaré/)).toBeInTheDocument();
    // Exactly one challenge, and it is not padded out with a second.
    expect(screen.getAllByTestId(/^yd-challenge-/)).toHaveLength(1);
  });

  it("names the category a challenge will be measured on, from /categories", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/Catégorie suivie : Loisirs/)).toBeInTheDocument();
  });

  it("re-reads the engagement after a decision, so the outcome refusal appears", async () => {
    // `POST .../accept` answers with `outcome_unavailable_reason: null` by
    // contract — the reason only exists on a subsequent read. A screen that
    // trusted the POST body would show an accepted challenge with no word
    // about why nothing was measured.
    const accepted: Engagement = {
      ...OPERATOR_ENGAGEMENT,
      challenges: [
        {
          ...OPERATOR_ENGAGEMENT.challenges[0],
          state: "accepted",
          decided_on: "2026-09-01",
          outcome_unavailable_reason:
            "Pas assez de temps écoulé depuis l'acceptation de ce défi : le résultat n'est " +
            "mesurable qu'une fois le mois suivant entièrement terminé.",
        },
      ],
    };
    let reads = 0;
    setupFetch(OPERATOR_ENGAGEMENT, {
      engagement: () => {
        reads += 1;
        return jsonResponse(reads === 1 ? OPERATOR_ENGAGEMENT : accepted);
      },
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Accepter le défi/ }));
    expect(await screen.findByText(/Pas assez de temps écoulé/)).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it("posts to the reject route when the challenge is turned down", async () => {
    const paths: string[] = [];
    setupFetch(OPERATOR_ENGAGEMENT, {
      onDecide: (path) => {
        paths.push(path);
        return jsonResponse({});
      },
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Rejeter le défi/ }));
    await waitFor(() => expect(paths).toEqual(["/api/engagement/challenges/1/reject"]));
  });

  it("raises a decision that was refused as an alert, not as content", async () => {
    // A 422 here is a genuine bad request — the challenge already left the
    // `proposed` state — and is the one thing on this screen that IS an error.
    setupFetch(OPERATOR_ENGAGEMENT, {
      onDecide: () =>
        jsonResponse({ detail: "Ce défi a déjà été accepté : son état ne peut plus changer." }, 422),
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Accepter le défi/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/déjà été accepté/);
  });

  it("says the whole screen failed to load rather than showing empty panels", async () => {
    setupFetch(OPERATOR_ENGAGEMENT, {
      engagement: () => jsonResponse({ detail: "Base indisponible" }, 500),
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Suivi indisponible/);
    expect(screen.queryByTestId("yd-health-score")).not.toBeInTheDocument();
  });

  it("still assembles the screen when only the category names fail", async () => {
    // The names are a convenience. Losing them must not cost the household its
    // streak, its score and its challenges — but the card then says the name
    // could not be retrieved rather than pretending there was no category.
    setupFetch(OPERATOR_ENGAGEMENT, {
      categories: () => jsonResponse({ detail: "Indisponible" }, 500),
    });
    renderPage();

    expect(await screen.findByTestId("yd-health-score")).toHaveTextContent("0");
    expect(screen.getByText(/nom n'a pas pu être retrouvé/)).toBeInTheDocument();
  });

  it("reserves the layout while loading instead of jumping when data lands", async () => {
    setupFetch();
    renderPage();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
