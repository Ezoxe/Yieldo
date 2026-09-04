import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { ApiError, api } from "../../lib/api";
import type { ChatMessage } from "../../lib/types";
import { AssistantPage } from "./AssistantPage";
import {
  ANSWERED,
  OPERATOR_CONVERSATION,
  REFUSED,
  SUPPORTED_FORMULATIONS,
  UNRECOGNISED,
} from "./fixtures";

// jsdom has no canvas, so ECharts cannot paint here. The chart's own contract
// (bars vs line, sign colouring, no ECharts legend) is covered by
// charts/AnswerChart.test.tsx; what this file tests is WHETHER a chart is
// rendered at all, which the stub answers exactly.
vi.mock("../../charts/AnswerChart", () => ({
  AnswerChart: () => <div data-testid="yd-answer-chart-stub" />,
}));

/** Every question POSTed by a render, in order. */
let asked: string[];
let deleted: number;

function mockApi(history: ChatMessage[] = [], reply: ChatMessage | Error = ANSWERED) {
  asked = [];
  deleted = 0;
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    if (path !== "/chat") throw new Error(`unexpected path ${path}`);
    return Promise.resolve(history as never);
  });
  vi.spyOn(api, "post").mockImplementation((path: string, body?: unknown) => {
    if (path !== "/chat") throw new Error(`unexpected path ${path}`);
    asked.push((body as { text: string }).text);
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve({ ...reply, id: 900 + asked.length } as never);
  });
  vi.spyOn(api, "delete").mockImplementation((path: string) => {
    if (path !== "/chat") throw new Error(`unexpected path ${path}`);
    deleted += 1;
    return Promise.resolve(undefined as never);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AssistantPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Votre question/), text);
  await user.click(screen.getByRole("button", { name: /^Demander$/ }));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the executed query, beside every answer", () => {
  it("prints the query in clear French next to the figure it produced", async () => {
    mockApi([ANSWERED]);
    renderPage();

    const exchange = await screen.findByTestId("yd-exchange-1");
    expect(within(exchange).getByTestId("yd-exchange-query-1")).toHaveTextContent(
      "Total des dépenses, catégorie : toutes catégories confondues",
    );
    expect(within(exchange).getByTestId("yd-exchange-answer-1")).toHaveTextContent(
      "7 963,47 €",
    );
  });

  it("prints it on a refusal too — a refused answer was still computed from something", async () => {
    mockApi([REFUSED]);
    renderPage();

    const exchange = await screen.findByTestId("yd-exchange-2");
    expect(within(exchange).getByTestId("yd-exchange-query-2")).toHaveTextContent(
      "Projection de patrimoine à 60 mois.",
    );
  });
});

describe("an engine refusal", () => {
  it("reaches the screen verbatim, and is never softened or wrapped", async () => {
    mockApi([REFUSED]);
    renderPage();

    const refusal = await screen.findByTestId("yd-exchange-refusal-2");
    expect(refusal).toHaveTextContent(
      "Aucun capital de départ : vous ne détenez aucune position. Saisissez vos comptes, vos positions et leurs lots sur l'écran Patrimoine.",
    );
    // Not an alert: a refusal is CONTENT, in the panel's own voice. Phase 2A
    // shipped one dressed as an alert and had to correct it.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps two different refusals as two different sentences", async () => {
    mockApi(OPERATOR_CONVERSATION);
    renderPage();
    await screen.findByTestId("yd-exchange-refusal-2");

    const sentences = screen
      .getAllByTestId(/^yd-exchange-refusal-/)
      .map((node) => node.textContent);
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe("the unrecognised-intent state", () => {
  it("is a designed state: the sentence, then the ten formulations it understands", async () => {
    mockApi([UNRECOGNISED]);
    renderPage();

    const exchange = await screen.findByTestId("yd-exchange-4");
    expect(exchange).toHaveTextContent(
      "Je n'ai pas compris cette question. Voici des formulations que je sais traiter :",
    );
    const suggestions = within(exchange).getAllByTestId(/^yd-suggestion-/);
    expect(suggestions).toHaveLength(10);
    expect(suggestions.map((node) => node.textContent)).toEqual(SUPPORTED_FORMULATIONS);
  });

  it("makes each formulation clickable, and asks it verbatim", async () => {
    const user = userEvent.setup();
    mockApi([UNRECOGNISED]);
    renderPage();
    await screen.findByTestId("yd-exchange-4");

    await user.click(screen.getByRole("button", { name: SUPPORTED_FORMULATIONS[4] }));

    await waitFor(() => expect(asked).toEqual([SUPPORTED_FORMULATIONS[4]]));
  });

  it("is not an error banner", async () => {
    mockApi([UNRECOGNISED]);
    renderPage();
    await screen.findByTestId("yd-exchange-4");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the chart an answer deserves", () => {
  it("draws one when the answer carries a decomposition", async () => {
    mockApi([ANSWERED]);
    renderPage();
    expect(await screen.findByTestId("yd-exchange-chart-1")).toBeInTheDocument();
  });

  it("draws nothing at all when it does not", async () => {
    mockApi([REFUSED]);
    renderPage();
    await screen.findByTestId("yd-exchange-2");
    expect(screen.queryByTestId("yd-exchange-chart-2")).toBeNull();
  });
});

describe("asking", () => {
  it("sends the question and shows the answer that comes back", async () => {
    mockApi([]);
    renderPage();
    await screen.findByTestId("yd-assistant-empty");

    await ask("Combien j'ai dépensé depuis novembre 2025 ?");

    await waitFor(() => expect(asked).toEqual(["Combien j'ai dépensé depuis novembre 2025 ?"]));
    expect(await screen.findByTestId("yd-exchange-901")).toHaveTextContent("7 963,47 €");
  });

  it("empties the field once the answer is on screen, so the next question starts clean", async () => {
    mockApi([]);
    renderPage();
    await screen.findByTestId("yd-assistant-empty");
    await ask("Combien j'ai dépensé depuis novembre 2025 ?");
    await screen.findByTestId("yd-exchange-901");
    expect(screen.getByLabelText(/Votre question/)).toHaveValue("");
  });

  it("refuses an empty question in French, before any round trip", async () => {
    const user = userEvent.setup();
    mockApi([]);
    renderPage();
    await screen.findByTestId("yd-assistant-empty");

    await user.click(screen.getByRole("button", { name: /^Demander$/ }));

    expect(screen.getByTestId("yd-assistant-error")).toHaveTextContent(
      "Écrivez une question avant de la poser.",
    );
    expect(asked).toEqual([]);
  });

  it("shows a failed round trip as an alert, not as an answer", async () => {
    mockApi([], new ApiError(422, "L'horizon d'une projection ne peut pas dépasser 600 mois."));
    renderPage();
    await screen.findByTestId("yd-assistant-empty");

    await ask("Quelle sera la valeur de mon patrimoine dans 900 ans ?");

    const alert = await screen.findByTestId("yd-assistant-error");
    expect(alert).toHaveTextContent("L'horizon d'une projection ne peut pas dépasser 600 mois.");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

describe("the empty conversation", () => {
  it("offers the ten formulations rather than an empty box", async () => {
    mockApi([]);
    renderPage();
    const empty = await screen.findByTestId("yd-assistant-empty");
    expect(within(empty).getAllByTestId(/^yd-suggestion-/)).toHaveLength(10);
  });

  it("asks a formulation when it is clicked", async () => {
    const user = userEvent.setup();
    mockApi([]);
    renderPage();
    await screen.findByTestId("yd-assistant-empty");

    await user.click(screen.getByRole("button", { name: SUPPORTED_FORMULATIONS[0] }));

    await waitFor(() => expect(asked).toEqual([SUPPORTED_FORMULATIONS[0]]));
  });
});

describe("clearing the conversation", () => {
  it("is offered only when there is something to clear", async () => {
    mockApi([]);
    renderPage();
    await screen.findByTestId("yd-assistant-empty");
    expect(screen.queryByRole("button", { name: /Effacer tout l.historique/ })).toBeNull();
  });

  it("calls the API and empties the screen", async () => {
    const user = userEvent.setup();
    mockApi(OPERATOR_CONVERSATION);
    renderPage();
    await screen.findByTestId("yd-exchange-1");

    await user.click(screen.getByRole("button", { name: /Effacer tout l.historique/ }));

    await waitFor(() => expect(deleted).toBe(1));
    expect(await screen.findByTestId("yd-assistant-empty")).toBeInTheDocument();
  });
});

describe("conversations", () => {
  it("continues the thread it is showing rather than opening one per question", async () => {
    // Before threads existed every question here landed in the same flat list.
    // Now that it lands in one, this screen must keep writing into the thread
    // whose end it is displaying — otherwise every question on this page would
    // open its own single-message thread and fill the drawer's list with them.
    const posted: unknown[] = [];
    mockApi([{ ...ANSWERED, conversation_id: 7 }]);
    vi.spyOn(api, "post").mockImplementation((_path: string, body?: unknown) => {
      posted.push(body);
      return Promise.resolve({ ...ANSWERED, id: 950, conversation_id: 7 } as never);
    });
    renderPage();
    await screen.findByTestId("yd-exchange-1");

    await ask("Et mes budgets ?");

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ conversation_id: 7 });
  });

  it("opens a new thread on an empty history", async () => {
    const posted: unknown[] = [];
    mockApi([]);
    vi.spyOn(api, "post").mockImplementation((_path: string, body?: unknown) => {
      posted.push(body);
      return Promise.resolve({ ...ANSWERED, id: 951, conversation_id: 1 } as never);
    });
    renderPage();
    await screen.findByTestId("yd-assistant-empty");

    await ask("Quel est mon solde net ?");

    await waitFor(() => expect(posted).toHaveLength(1));
    // null, never a number this screen invented.
    expect(posted[0]).toMatchObject({ conversation_id: null });
  });

  it("«Nouvelle conversation» stops adding to the thread without erasing it", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    mockApi([{ ...ANSWERED, conversation_id: 7 }]);
    vi.spyOn(api, "post").mockImplementation((_path: string, body?: unknown) => {
      posted.push(body);
      return Promise.resolve({ ...ANSWERED, id: 952, conversation_id: 8 } as never);
    });
    renderPage();
    await screen.findByTestId("yd-exchange-1");

    await user.click(screen.getByRole("button", { name: /Nouvelle conversation/ }));
    // Erases nothing: the thread stays on screen until the next question opens
    // a new one. Deleting is a different button, with a different word on it.
    expect(screen.getByTestId("yd-exchange-1")).toBeInTheDocument();
    expect(deleted).toBe(0);

    await ask("Quel est mon solde net ?");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ conversation_id: null });
  });
});
