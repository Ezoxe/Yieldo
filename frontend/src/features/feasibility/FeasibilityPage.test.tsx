import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Feasibility, FeasibilityContext } from "../../lib/types";
import { FeasibilityPage } from "./FeasibilityPage";
import { OPERATOR_CONTEXT, OPERATOR_REPORT } from "./fixtures";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchOverrides {
  context?: () => Response;
  assess?: (body: unknown) => Response;
  scenarios?: () => Response;
}

function setupFetch(
  context: FeasibilityContext = OPERATOR_CONTEXT,
  report: Feasibility = OPERATOR_REPORT,
  overrides: FetchOverrides = {},
) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const parsed = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.pathname === "/api/feasibility/context") {
      return Promise.resolve(overrides.context ? overrides.context() : jsonResponse(context));
    }
    if (url.pathname === "/api/feasibility/scenarios") {
      return Promise.resolve(overrides.scenarios ? overrides.scenarios() : jsonResponse([]));
    }
    if (url.pathname === "/api/feasibility" && method === "POST") {
      return Promise.resolve(overrides.assess ? overrides.assess(parsed) : jsonResponse(report));
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
    <MemoryRouter initialEntries={["/faisabilite"]}>
      <ThemeProvider>
        <FeasibilityPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function askTheOperatorsQuestion(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Prix du bien/), "40000");
  await user.click(screen.getByRole("button", { name: /Calculer/ }));
}

describe("FeasibilityPage — the measured context, before any question", () => {
  it("states the negative capacity before the user has typed a price", async () => {
    setupFetch();
    renderPage();

    // The honest ordering: he learns his capacity is negative BEFORE the form.
    expect(await screen.findByText(/−746,19/)).toBeInTheDocument();
    expect(screen.getByText(/Votre épargne recule au rythme mesuré/)).toBeInTheDocument();
    // And the remedy named is not the import screen.
    expect(screen.queryByRole("link", { name: /Importer des relevés/ })).not.toBeInTheDocument();
  });

  it("states the expense rate, the income rate, the balance and the instalments", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText(/2 654,49/)).toBeInTheDocument(); // expense rate
    expect(screen.getByText(/471,11/)).toBeInTheDocument(); // income rate
    expect(screen.getByText(/−2 209,63/)).toBeInTheDocument(); // liquid balance
    expect(screen.getByText(/197 opérations/)).toBeInTheDocument();
  });

  it("offers the import screen only when the capacity really is unmeasurable", async () => {
    setupFetch({ ...OPERATOR_CONTEXT, capacity: null, months_observed: 1 });
    renderPage();

    expect(await screen.findByRole("link", { name: /Importer des relevés/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Non mesurable/)).toHaveLength(1);
  });

  it("says nothing has been asked yet rather than showing an empty verdict", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText(/Aucune question posée/)).toBeInTheDocument();
    expect(screen.queryByText(/Hors de portée/)).not.toBeInTheDocument();
  });
});

describe("FeasibilityPage — asking the question", () => {
  it("answers the operator's 40 000 € question with the verdict and its figures", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();
    await askTheOperatorsQuestion(user);

    expect(await screen.findByText(/Hors de portée/)).toBeInTheDocument();
    expect(screen.getByText(/−8 954,28/)).toBeInTheDocument();
    expect(screen.getByText(/Il manque 48 954,28/)).toBeInTheDocument();
    // Scoped: the three context tiles quote the same sample above, and an
    // unscoped match would pass on a verdict that never stated its own.
    expect(
      within(screen.getByTestId("yd-verdict")).getByText(/3 mois de relevés/),
    ).toBeInTheDocument();
  });

  it("sends integer cents, never a float", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();
    await askTheOperatorsQuestion(user);

    // On the POST itself rather than on a call count, which changes whenever a
    // panel adds a GET of its own.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).target_cents).toBe(4_000_000);
  });

  it("renders an engine's 422 as content, not as a load failure", async () => {
    const user = userEvent.setup();
    const refusal = "L'échéance doit être comprise entre 1 et 600 mois.";
    setupFetch(OPERATOR_CONTEXT, OPERATOR_REPORT, {
      assess: () => jsonResponse({ detail: refusal }, 422),
    });
    renderPage();
    await askTheOperatorsQuestion(user);

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    // A refusal is a deliberate answer. Phase 2A shipped one dressed as an
    // alert on exactly this branch.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("raises an alert for a genuine network failure", async () => {
    const user = userEvent.setup();
    setupFetch(OPERATOR_CONTEXT, OPERATOR_REPORT, {
      assess: () => jsonResponse({ detail: "Boom" }, 500),
    });
    renderPage();
    await askTheOperatorsQuestion(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Le calcul n'a pas abouti/);
  });
});
