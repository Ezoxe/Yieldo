import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRun, Proposal } from "../../lib/types";
import { ProposalsPage } from "./ProposalsPage";
import { useProposalCount } from "./useProposalCount";

const pendingProposal: Proposal = {
  id: 1,
  run_id: 1,
  kind: "category_budget",
  summary: "Poser un budget de 450,00 € par mois sur Alimentation",
  evidence: "Moyenne réelle des six derniers mois : 438,20 €",
  payload: { category_id: 2, monthly_budget_cents: 45000 },
  before: {},
  state: "pending",
  decision_note: null,
  applied_summary: null,
  affected: 0,
  created_at: "2026-09-05T09:12:00Z",
  decided_at: null,
};

const run: AgentRun = {
  id: 1,
  question: "Propose-moi un budget alimentation",
  state: "answered",
  answer: "Vos courses tiennent entre 402 € et 471 €.",
  notice: null,
  steps_used: 3,
  created_at: "2026-09-05T09:11:00Z",
  finished_at: "2026-09-05T09:12:00Z",
  steps: [
    { position: 0, kind: "tool_call", name: "lire_synthese",
      summary: "Appel de l'outil « lire_synthese »" },
    { position: 1, kind: "tool_result", name: "lire_synthese",
      summary: "Sorties 2 629,20 € sur la période." },
    { position: 2, kind: "answer", name: "", summary: "Proposition déposée." },
  ],
  proposals: [],
};

const fetchMock = vi.fn();

function jsonOf(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function routeFetch(proposals: Proposal[] = [pendingProposal], runs: AgentRun[] = [run]) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.pathname === "/api/agent/run") {
      return jsonOf({ ...run, id: 2, question: "Nouvelle demande" });
    }
    if (method === "POST" && url.pathname.endsWith("/apply")) {
      return jsonOf({ ...pendingProposal, state: "applied",
                      applied_summary: "Budget fixé", affected: 1 });
    }
    if (method === "POST" && url.pathname.endsWith("/refuse")) {
      return jsonOf({ ...pendingProposal, state: "refused" });
    }
    if (url.pathname === "/api/agent/proposals") {
      const wanted = url.searchParams.get("state");
      return jsonOf(wanted === null ? proposals
                                    : proposals.filter((item) => item.state === wanted));
    }
    if (url.pathname === "/api/agent/runs") return jsonOf(runs);
    return { ok: false, status: 404,
             clone: () => ({ json: async () => ({ detail: "?" }) }),
             json: async () => ({ detail: "?" }) };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useProposalCount.setState({ pending: 0 });
});

function renderPage() {
  render(
    <MemoryRouter>
      <ProposalsPage />
    </MemoryRouter>,
  );
}

describe("ProposalsPage", () => {
  it("says in its lead that nothing here has happened yet", async () => {
    routeFetch();
    renderPage();

    expect(await screen.findByText(/Rien ici n'est appliqué tant que vous ne l'avez pas validé/))
      .toBeInTheDocument();
  });

  it("shows the change, the engine figure behind it, and the exact payload", async () => {
    routeFetch();
    renderPage();

    expect(await screen.findByText(pendingProposal.summary)).toBeInTheDocument();
    expect(screen.getByText(/438,20 €/)).toBeInTheDocument();
    expect(screen.getByText(/Ce qui serait modifié, exactement/)).toBeInTheDocument();
    expect(screen.getByText(/"monthly_budget_cents": 45000/)).toBeInTheDocument();
  });

  // A model-authored number with nothing behind it is named, not hidden and
  // not quietly presented like the others.
  it("names a proposal with no engine figure behind it", async () => {
    routeFetch([{ ...pendingProposal, evidence: "   " }]);
    renderPage();

    expect(await screen.findByText(/Aucun chiffre de Yieldo ne justifie/)).toBeInTheDocument();
  });

  it("applies a proposal only when the button is pressed", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(pendingProposal.summary);

    // Nothing was applied on load.
    expect(fetchMock.mock.calls.some(([, init]) =>
      (init as RequestInit | undefined)?.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/agent/proposals/1/apply"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("refuses a proposal without applying it", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(pendingProposal.summary);

    await user.click(screen.getByRole("button", { name: /Refuser/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/agent/proposals/1/refuse"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("diagnoses an empty queue rather than showing a blank panel", async () => {
    routeFetch([]);
    renderPage();

    expect(await screen.findByText("Rien à valider")).toBeInTheDocument();
    expect(screen.getByText(/attendra votre accord/)).toBeInTheDocument();
  });

  it("keeps a decided proposal with its reason", async () => {
    routeFetch([
      { ...pendingProposal, id: 9, state: "refused", decision_note: "Pas d'accord" },
    ]);
    renderPage();

    await screen.findByText("Rien à valider");
    expect(screen.getByText(/1 décision passée/)).toBeInTheDocument();
    expect(screen.getByText(/Motif : Pas d'accord/)).toBeInTheDocument();
  });

  it("prints what the model actually ran, step by step", async () => {
    routeFetch();
    renderPage();

    const trace = await screen.findByText("Ce que l'IA a réellement fait");
    expect(trace).toBeInTheDocument();
    // Both the call and its result name the tool, which is the point: the
    // trace shows what was asked for even when the answer to it was an error.
    expect(screen.getAllByText("lire_synthese")).toHaveLength(2);
    expect(screen.getByText("Sorties 2 629,20 € sur la période.")).toBeInTheDocument();
  });

  // The rule the whole trace design turns on: the front end says only what it
  // can see. One request is running — never a phase-by-phase progress report.
  it("claims nothing about progress while a run is in flight", async () => {
    routeFetch();
    let release: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === "/api/agent/run") {
        await new Promise((resolve) => {
          release = resolve;
        });
        return jsonOf(run);
      }
      if (url.pathname === "/api/agent/proposals") return jsonOf([]);
      if (url.pathname === "/api/agent/runs") return jsonOf([]);
      return jsonOf([]);
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Rien à valider");

    await user.type(screen.getByLabelText("Votre demande"), "Analyse mes courses");
    await user.click(screen.getByRole("button", { name: /Lancer l'analyse/ }));

    const status = await screen.findByText("Une requête est en cours.");
    expect(status).toBeInTheDocument();
    // Nothing that would amount to a fabricated phase.
    expect(screen.queryByText(/étape 1 sur/i)).not.toBeInTheDocument();
    release(undefined);
  });

  it("refuses to send an empty question", async () => {
    routeFetch([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Rien à valider");

    await user.click(screen.getByRole("button", { name: /Lancer l'analyse/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Écrivez une question/);
    expect(fetchMock.mock.calls.some(([, init]) =>
      (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("surfaces a run that failed rather than showing an empty panel", async () => {
    routeFetch([], [{
      ...run, state: "failed", answer: null,
      notice: "Le modèle est injoignable : vérifiez l'URL dans Réglages → Connexions.",
      steps: [],
    }]);
    renderPage();

    expect(await screen.findByText(/Le modèle est injoignable/)).toBeInTheDocument();
  });
});

describe("useProposalCount", () => {
  it("counts only what is pending", async () => {
    routeFetch([pendingProposal, { ...pendingProposal, id: 5, state: "applied" }]);

    await useProposalCount.getState().refresh();

    expect(useProposalCount.getState().pending).toBe(1);
  });

  // "Nothing is waiting" is a claim, and the one thing this store must not do
  // is quietly make it after a failed request.
  it("never falls back to a confident zero", async () => {
    useProposalCount.setState({ pending: 3 });
    fetchMock.mockRejectedValue(new Error("réseau"));

    await useProposalCount.getState().refresh();

    expect(useProposalCount.getState().pending).toBe(3);
  });
});

describe("the trace panel", () => {
  it("shows nothing at all when there are no steps", async () => {
    routeFetch([], [{ ...run, steps: [] }]);
    renderPage();

    await screen.findByText("Rien à valider");
    expect(screen.queryByText("Ce que l'IA a réellement fait")).not.toBeInTheDocument();
  });

  it("labels each kind of step in French", async () => {
    routeFetch();
    renderPage();

    const trace = (await screen.findByText("Ce que l'IA a réellement fait")).closest("details");
    expect(trace).not.toBeNull();
    const inTrace = within(trace as HTMLElement);
    expect(inTrace.getByText("Consultation")).toBeInTheDocument();
    expect(inTrace.getByText("Résultat")).toBeInTheDocument();
    expect(inTrace.getByText("Conclusion")).toBeInTheDocument();
  });
});
