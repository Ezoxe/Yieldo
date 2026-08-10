import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, setAccessToken } from "../../lib/api";
import { useSession } from "./session";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
  useSession.setState({ user: null, accessToken: null, status: "idle", isAuthenticated: false });
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("session store", () => {
  it("keeps useSession().accessToken in sync after a silent 401-triggered refresh", async () => {
    // Simulate an already-authenticated session whose token has gone stale
    // (e.g. it expired server-side) — session.ts wires api.ts's
    // onTokenRefreshed hook to applySession, the exact function login/
    // register/hydrate use, so this must update in lockstep with api.ts's
    // own module-scope accessToken rather than staying behind.
    setAccessToken("stale");
    useSession.setState({
      accessToken: "stale",
      status: "authenticated",
      isAuthenticated: true,
      user: { id: 1, email: "max@example.com", name: "Max", role: "user" },
    });

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentification requise" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "fresh",
          user: { id: 1, email: "max@example.com", name: "Max", role: "user" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ total: 0, items: [] }));

    await api.get("/transactions");

    expect(useSession.getState().accessToken).toBe("fresh");
    expect(useSession.getState().status).toBe("authenticated");
  });
});
