import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Outlook } from "../../lib/types";
import { AvenirPage } from "./AvenirPage";
import { OUTLOOK, RELIABILITY } from "./fixtures";

const fetchMock = vi.fn();
let outlook: Outlook = OUTLOOK;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  outlook = OUTLOOK;
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/outlook") return Promise.resolve(json(outlook));
    if (url.pathname === "/api/outlook/reliability") return Promise.resolve(json(RELIABILITY));
    if (url.pathname === "/api/cashflow/runway") return new Promise<Response>(() => {});
    if (url.pathname === "/api/planned-events") return Promise.resolve(json([]));
    return Promise.resolve(json({ detail: `inattendu ${url.pathname}` }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AvenirPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("AvenirPage", () => {
  it("answers first: the month end, the low point and how reliable that is", async () => {
    renderPage();

    expect(await screen.findByText("Fin septembre prévue")).toBeInTheDocument();
    expect(screen.getByText("+2 241,02 €")).toBeInTheDocument();
    expect(screen.getByText("−184,57 €")).toBeInTheDocument();
    expect(screen.getByText("27 septembre, veille de VIR SEPA ACME SAS SALAIRE")).toBeInTheDocument();
    expect(screen.getByText("Découvert probable")).toBeInTheDocument();
    expect(screen.getByText("±330 €")).toBeInTheDocument();
    expect(screen.getByText("à 1 mois · 9 fois sur 12 dans la fourchette")).toBeInTheDocument();
  });

  it("asks for the other perimeter when the reader switches to it", async () => {
    renderPage();
    await screen.findByText("Fin septembre prévue");

    await userEvent.click(screen.getByRole("button", { name: "Tout le disponible" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("scope=liquid"))).toBe(
        true,
      ),
    );
    expect(screen.getByRole("button", { name: "Tout le disponible" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("asks for a year when the reader zooms out", async () => {
    renderPage();
    await screen.findByText("Fin septembre prévue");

    await userEvent.click(screen.getByRole("button", { name: "12 mois" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("horizon_days=365")),
      ).toBe(true),
    );
  });

  it("says when the statements stop, and only when they are stale", async () => {
    outlook = { ...OUTLOOK, stale_days: 30 };
    renderPage();

    expect(
      await screen.findByText(/Vos relevés s'arrêtent au 22 septembre/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importer mes relevés" })).toHaveAttribute(
      "href",
      "/import",
    );
  });

  it("stays quiet about staleness on a fresh ledger", async () => {
    renderPage();
    await screen.findByText("Fin septembre prévue");
    expect(screen.queryByText(/Vos relevés s'arrêtent/)).not.toBeInTheDocument();
  });

  it("says how to start on a perimeter without an account", async () => {
    outlook = { ...OUTLOOK, days: [], months: [], events: [], low_point: null,
                empty_reason: "Aucun compte courant : créez-en un dans Import pour voir votre avenir." };
    renderPage();
    expect(await screen.findByText(/Aucun compte courant/)).toBeInTheDocument();
  });
});
