import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "../auth/session";
import { SessionsPanel } from "./SessionsPanel";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("SessionsPanel", () => {
  it("signs the other devices out and keeps this one", async () => {
    const user = { id: 1, email: "max@example.com", name: "Max", role: "admin" };
    fetchMock.mockResolvedValue(json({ access_token: "neuf", token_type: "bearer", user }));
    render(<SessionsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Déconnecter les autres appareils" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Les autres appareils sont déconnectés.",
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/sessions/revoke-others");
    expect(useSession.getState().accessToken).toBe("neuf");
  });

  it("prints the backend's refusal", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Droits insuffisants" }, 403));
    render(<SessionsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Déconnecter les autres appareils" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Droits insuffisants");
  });
});
