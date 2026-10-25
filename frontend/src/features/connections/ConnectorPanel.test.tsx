import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectorPanel, KEY_FILE, actionPill } from "./ConnectorPanel";

const fetchMock = vi.fn();
const TOKEN = `ycn_a1b2c3d4e5f6_${"9".repeat(64)}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const actions = [
  {
    id: 2, tool: "yieldo_supprimer_transaction", title: "Supprimer une transaction.",
    tier: "approve", approval_id: "apv_1", status_code: 204, created_at: "2026-10-25T08:44:00Z",
  },
  {
    id: 1, tool: "yieldo_corriger_transaction", title: "Catégoriser une transaction.",
    tier: "write", approval_id: null, status_code: 404, created_at: "2026-10-24T21:15:00Z",
  },
];

function setupFetch(exists: boolean) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/connector-key" && method === "GET") {
      return Promise.resolve(jsonResponse(exists
        ? { exists: true, created_at: "2026-10-20T19:02:00Z", last_used_at: null }
        : { exists: false, created_at: null, last_used_at: null }));
    }
    if (url === "/api/connector-key/actions") return Promise.resolve(jsonResponse(actions));
    if (url === "/api/connector-key" && method === "POST") {
      return Promise.resolve(jsonResponse({ key: TOKEN, created_at: "2026-10-25T10:00:00Z" }, 201));
    }
    if (url === "/api/connector-key" && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ConnectorPanel", () => {
  it("says there is no key and offers to create one", async () => {
    setupFetch(false);
    render(<ConnectorPanel />);

    expect(await screen.findByText(/Aucune clé/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer la clé" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Révoquer" })).not.toBeInTheDocument();
  });

  it("shows a new key once, with where to paste it", async () => {
    setupFetch(false);
    render(<ConnectorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Créer la clé" }));

    expect(await screen.findByLabelText("Clé du connecteur")).toHaveTextContent(TOKEN);
    expect(screen.getByText(KEY_FILE)).toBeInTheDocument();
    expect(KEY_FILE).toBe("data/yieldo_key");
    expect(screen.getByText(/ne sera plus affichée/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remplacer la clé" })).toBeInTheDocument();
  });

  it("never shows a key that already exists, only when it was made", async () => {
    setupFetch(true);
    render(<ConnectorPanel />);

    expect(await screen.findByTestId("yd-connector-state")).toHaveTextContent("jamais utilisée");
    expect(screen.queryByLabelText("Clé du connecteur")).not.toBeInTheDocument();
  });

  it("revokes the key", async () => {
    setupFetch(true);
    render(<ConnectorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Révoquer" }));

    await waitFor(() => expect(screen.getByText(/Aucune clé/)).toBeInTheDocument());
  });

  it("lists what Claude did, with whether it went through Discord", async () => {
    setupFetch(true);
    render(<ConnectorPanel />);

    expect(await screen.findByText("Ce que Claude a fait")).toBeInTheDocument();
    expect(screen.getByText("Supprimer une transaction.")).toBeInTheDocument();
    expect(screen.getByText("Validé sur Discord")).toBeInTheDocument();
    expect(screen.getByText("Refusé par Yieldo (404)")).toBeInTheDocument();
  });
});

describe("actionPill", () => {
  it("tells a direct write from an approved one and from a refusal", () => {
    expect(actionPill({ ...actions[0], tier: "write" } as never).text).toBe("Fait");
    expect(actionPill(actions[0] as never).text).toBe("Validé sur Discord");
    expect(actionPill(actions[1] as never).tone).toBe("negative");
  });
});
