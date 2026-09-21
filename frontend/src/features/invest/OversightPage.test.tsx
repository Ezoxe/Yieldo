import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { InvestJournal, InvestReplay } from "../../lib/types";
import { OversightPage } from "./OversightPage";

const fetchMock = vi.fn();

const JOURNAL: InvestJournal = {
  events: 1, intact: true, broken_at: null,
  message: "La seule entrée du journal est scellée.",
  next_sequence: 2,
  entries: [{
    sequence: 1, kind: "decision", actor: "pilot", payload: {},
    entry_hash: "a".repeat(64), previous_hash: "0".repeat(64),
    created_at: "2026-09-20T10:00:00Z",
  }],
};

const REPLAY: InvestReplay = {
  decision_id: 12, inputs_intact: true,
  inputs_hash_stored: "b".repeat(64), inputs_hash_recomputed: "b".repeat(64),
  matches: true, stored_answers: {}, replayed_answers: {}, provider: "replay",
  verdict: "Rejeu conforme : la décision du 20/09/2026 est reproductible.",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/invest/oversight/journal") return Promise.resolve(json(JOURNAL));
    if (url.pathname.startsWith("/api/invest/oversight/replay/") && init?.method === "POST") {
      return Promise.resolve(json(REPLAY));
    }
    throw new Error(`Unhandled fetch: ${url.pathname}`);
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/invest/supervision"]}>
        <ThemeProvider>
          <OversightPage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OversightPage — replaying a decision", () => {
  it("replays on Enter in the number field, not only on the button", async () => {
    // One field and one button: pressing Enter in the field is what everyone
    // tries first, and a form that ignores it reads as broken.
    renderPage();
    const field = await screen.findByLabelText(/Numéro de la décision/);
    await userEvent.type(field, "12{Enter}");

    expect(await screen.findByText(/est reproductible/)).toBeInTheDocument();
    const posted = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(String(posted?.[0])).toContain("/api/invest/oversight/replay/12");
  });

  it("does nothing on Enter while the field is empty", async () => {
    renderPage();
    const field = await screen.findByLabelText(/Numéro de la décision/);
    await userEvent.type(field, "{Enter}");

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST"))
      .toBe(false);
  });
});
