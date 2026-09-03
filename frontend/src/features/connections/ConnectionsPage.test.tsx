import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { ApiError, api } from "../../lib/api";
import type { Connection, LlmSettings } from "../../lib/types";
import { ConnectionsPage } from "./ConnectionsPage";
import { CONNECTIONS, CONNECTIONS_WITH_FINNHUB, LLM_LOCAL, LLM_UNSET } from "./fixtures";

/** Every body this render POSTed, PUT or DELETEd, in order. */
let posted: Array<{ path: string; body: unknown }>;
let putted: Array<{ path: string; body: unknown }>;
let deleted: string[];

interface MockOptions {
  connections?: Connection[];
  llm?: LlmSettings;
  postResult?: unknown;
  postError?: Error;
  deleteError?: Error;
}

function mockApi(options: MockOptions = {}) {
  posted = [];
  putted = [];
  deleted = [];
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    if (path === "/connections") {
      return Promise.resolve((options.connections ?? CONNECTIONS) as never);
    }
    if (path === "/assistant/llm-settings") {
      return Promise.resolve((options.llm ?? LLM_UNSET) as never);
    }
    throw new Error(`unexpected path ${path}`);
  });
  vi.spyOn(api, "post").mockImplementation((path: string, body?: unknown) => {
    posted.push({ path, body });
    if (options.postError) return Promise.reject(options.postError);
    return Promise.resolve(
      (options.postResult ?? {
        ...CONNECTIONS_WITH_FINNHUB[0],
        valid: true,
        reason: null,
      }) as never,
    );
  });
  vi.spyOn(api, "put").mockImplementation((path: string, body?: unknown) => {
    putted.push({ path, body });
    const payload = body as { endpoint_url: string; model_name: string };
    return Promise.resolve({
      configured: true,
      endpoint_url: payload.endpoint_url,
      model_name: payload.model_name,
      has_key: false,
    } as never);
  });
  vi.spyOn(api, "delete").mockImplementation((path: string) => {
    deleted.push(path);
    if (options.deleteError) return Promise.reject(options.deleteError);
    if (path === "/assistant/llm-settings") return Promise.resolve(LLM_UNSET as never);
    return Promise.resolve(undefined as never);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ConnectionsPage />
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

describe("ConnectionsPage — the write-only contract", () => {
  it("never renders a masked value that looks like a key that could be read back", async () => {
    mockApi({ connections: CONNECTIONS_WITH_FINNHUB });
    renderPage();

    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    expect(finnhub).toHaveTextContent("Clé enregistrée");

    // The field is EMPTY even with a key stored: there is nothing to prefill
    // it with, and a row of bullets would read as a value one could reveal.
    const field = within(finnhub).getByLabelText(/Remplacer la clé/);
    expect(field).toHaveValue("");
    expect(finnhub.textContent).not.toMatch(/[•*]{3,}/);
    expect(finnhub).toHaveTextContent("Yieldo ne vous rendra jamais cette clé");
  });

  it("asks for a key when none is stored", async () => {
    renderPage();
    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    expect(within(finnhub).getByLabelText("Clé d'API")).toHaveValue("");
    expect(within(finnhub).queryByLabelText(/Remplacer la clé/)).not.toBeInTheDocument();
  });

  it("offers only to REPLACE once a key is stored — never to read it", async () => {
    mockApi({ connections: CONNECTIONS_WITH_FINNHUB });
    renderPage();
    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    expect(within(finnhub).getByLabelText(/Remplacer la clé/)).toBeInTheDocument();
    expect(within(finnhub).queryByLabelText("Clé d'API")).not.toBeInTheDocument();
  });

  it("empties the field after a save, so the key never lingers in the DOM", async () => {
    const user = userEvent.setup();
    renderPage();

    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    const field = within(finnhub).getByLabelText("Clé d'API");
    await user.type(field, "sk-tres-secret-123");
    await user.click(within(finnhub).getByRole("button", { name: /Valider et enregistrer/ }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      path: "/connections/finnhub",
      body: { api_key: "sk-tres-secret-123" },
    });
    await waitFor(() => expect(field).toHaveValue(""));
    expect(document.body.textContent).not.toContain("sk-tres-secret-123");
  });
});

describe("ConnectionsPage — providers that need no key", () => {
  it("renders no key field at all for CoinGecko and Frankfurter", async () => {
    renderPage();

    for (const provider of ["coingecko", "frankfurter"]) {
      const card = await screen.findByTestId(`yd-conn-${provider}`);
      expect(card).toHaveTextContent("Aucune clé requise");
      expect(within(card).queryByLabelText(/Clé/)).not.toBeInTheDocument();
      expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
      expect(
        within(card).queryByRole("button", { name: /Valider et enregistrer/ }),
      ).not.toBeInTheDocument();
      // And it says why, rather than leaving an absence to be read as a chore.
      expect(
        within(card).getByTestId(`yd-conn-nokey-${provider}`),
      ).toHaveTextContent("Aucune clé n'est nécessaire");
    }
  });

  it("says Frankfurter has no ceiling rather than printing a made-up one", async () => {
    renderPage();
    const card = await screen.findByTestId("yd-conn-frankfurter");
    expect(card).toHaveTextContent("accès illimité, aucun plafond à surveiller");
    expect(card).not.toHaveTextContent("plafond de prudence");
  });

  it("still shows the three providers that DO need a key with a field each", async () => {
    renderPage();
    for (const provider of ["finnhub", "alpha_vantage", "exchangerate_api"]) {
      const card = await screen.findByTestId(`yd-conn-${provider}`);
      expect(within(card).getByLabelText("Clé d'API")).toBeInTheDocument();
      expect(card).toHaveTextContent("Aucune clé");
      expect(card).not.toHaveTextContent("Aucune clé requise");
    }
  });
});

describe("ConnectionsPage — the cause you were given is the cause printed", () => {
  it("prints the provider's own refusal verbatim, without rewording it", async () => {
    const refusal =
      "Le quota d'appels vers Finnhub est épuisé pour cette période : il sera réinitialisé le 03/09/2026 à 10:00.";
    mockApi({
      postResult: { ...CONNECTIONS[0], valid: false, reason: refusal },
    });
    const user = userEvent.setup();
    renderPage();

    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    await user.type(within(finnhub).getByLabelText("Clé d'API"), "sk-x");
    await user.click(within(finnhub).getByRole("button", { name: /Valider et enregistrer/ }));

    const outcome = await screen.findByTestId("yd-conn-outcome-finnhub");
    await waitFor(() => expect(outcome).toHaveTextContent(refusal));
    // A refused key is a real answer, not a broken round trip: no alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says plainly when the key worked, and that a real call proved it", async () => {
    const user = userEvent.setup();
    renderPage();

    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    await user.type(within(finnhub).getByLabelText("Clé d'API"), "sk-ok");
    await user.click(within(finnhub).getByRole("button", { name: /Valider et enregistrer/ }));

    await waitFor(() =>
      expect(screen.getByTestId("yd-conn-outcome-finnhub")).toHaveTextContent(
        "Clé validée par un appel réel au fournisseur",
      ),
    );
    // And the card has moved to its configured state, from the API's answer.
    await waitFor(() =>
      expect(screen.getByTestId("yd-conn-finnhub")).toHaveTextContent("Clé enregistrée"),
    );
  });

  it("raises an alert only when the round trip itself failed", async () => {
    mockApi({ postError: new ApiError(500, "Le serveur n'a pas répondu.") });
    const user = userEvent.setup();
    renderPage();

    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    await user.type(within(finnhub).getByLabelText("Clé d'API"), "sk-x");
    await user.click(within(finnhub).getByRole("button", { name: /Valider et enregistrer/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Le serveur n'a pas répondu.");
  });

  it("deletes a stored key and says the provider is no longer called", async () => {
    mockApi({ connections: CONNECTIONS_WITH_FINNHUB });
    const user = userEvent.setup();
    renderPage();

    const finnhub = await screen.findByTestId("yd-conn-finnhub");
    await user.click(within(finnhub).getByRole("button", { name: /Supprimer la clé/ }));

    await waitFor(() => expect(deleted).toEqual(["/connections/finnhub"]));
    await waitFor(() =>
      expect(screen.getByTestId("yd-conn-outcome-finnhub")).toHaveTextContent("Clé supprimée"),
    );
    expect(screen.getByTestId("yd-conn-finnhub")).toHaveTextContent("Aucune clé");
  });
});

describe("ConnectionsPage — the model", () => {
  it("states on screen that the model never calculates", async () => {
    renderPage();
    const contract = await screen.findByTestId("yd-llm-contract");
    expect(contract).toHaveTextContent("Le modèle ne calcule jamais");
    expect(contract).toHaveTextContent("aucun montant à l'écran ne peut venir de lui");
  });

  it("says the assistant still answers with no model configured", async () => {
    renderPage();
    const state = await screen.findByTestId("yd-llm-state");
    expect(state).toHaveTextContent("Aucun modèle n'est configuré");
    expect(state).toHaveTextContent("moteur déterministe");
  });

  it("sends an untouched key field as null so a stored key survives an edit", async () => {
    mockApi({ llm: LLM_LOCAL });
    const user = userEvent.setup();
    renderPage();

    const model = await screen.findByLabelText("Nom du modèle");
    await user.clear(model);
    await user.type(model, "qwen2.5:14b");
    await user.click(screen.getByRole("button", { name: /Enregistrer le modèle/ }));

    await waitFor(() => expect(putted).toHaveLength(1));
    expect(putted[0].body).toEqual({
      endpoint_url: "http://localhost:11434/v1",
      model_name: "qwen2.5:14b",
      api_key: null,
    });
  });

  it("prefills the endpoint and model but never a key", async () => {
    mockApi({ llm: LLM_LOCAL });
    renderPage();

    expect(await screen.findByLabelText("URL de l'endpoint")).toHaveValue(
      "http://localhost:11434/v1",
    );
    expect(screen.getByLabelText("Nom du modèle")).toHaveValue("llama3.1:8b");
    expect(screen.getByLabelText(/Clé \(facultatif\)/)).toHaveValue("");
    expect(screen.getByTestId("yd-llm-state")).toHaveTextContent(
      "Aucune clé n'est enregistrée — un endpoint local n'en demande pas",
    );
  });

  it("refuses to submit an endpoint or a model name that is empty", async () => {
    renderPage();
    await screen.findByLabelText("URL de l'endpoint");
    expect(screen.getByRole("button", { name: /Enregistrer le modèle/ })).toBeDisabled();
  });

  it("deletes the model and says the assistant keeps working", async () => {
    mockApi({ llm: LLM_LOCAL });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /Supprimer le modèle/ }),
    );
    await waitFor(() => expect(deleted).toEqual(["/assistant/llm-settings"]));
    await waitFor(() =>
      expect(screen.getByTestId("yd-llm-outcome")).toHaveTextContent(
        "ses chiffres n'ont jamais dépendu d'un modèle",
      ),
    );
  });
});

describe("ConnectionsPage — the state of the whole installation", () => {
  it("opens on the operator's own state: no key anywhere, and says what that costs", async () => {
    renderPage();
    const summary = await screen.findByTestId("yd-connections-summary");
    expect(summary).toHaveTextContent("Aucune clé enregistrée sur les 3 fournisseurs");
    expect(summary).toHaveTextContent("prix de revient");
  });

  it("lists every provider exactly once, each with a stable key", async () => {
    renderPage();
    const list = await screen.findByTestId("yd-connections-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });

  it("shows a load failure as an alert rather than an empty screen", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(503, "Service indisponible."));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Service indisponible.");
  });
});
