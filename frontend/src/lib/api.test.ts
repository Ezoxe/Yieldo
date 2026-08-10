import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, setAccessToken } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  it("sends the bearer token when one is set", async () => {
    setAccessToken("token-123");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get("/health");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer token-123");
  });

  it("serializes query parameters and drops empty ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await api.get("/transactions", { search: "netflix", category_id: undefined, limit: 50 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/transactions?search=netflix&limit=50");
  });

  it("raises ApiError carrying the French detail from the backend", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Compte introuvable" }, 404));
    await expect(api.get("/accounts/9")).rejects.toMatchObject({
      status: 404,
      detail: "Compte introuvable",
    });
  });

  it("falls back to a generic French message when the body has no detail", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/x")).rejects.toMatchObject({
      detail: "Une erreur inattendue est survenue.",
    });
  });

  it("retries once through refresh after a 401, then replays the request", async () => {
    setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentification requise" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh", user: { id: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ total: 0, items: [] }));

    const result = await api.get<{ total: number }>("/transactions");

    expect(result.total).toBe(0);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh");
  });

  it("does not loop when the refresh itself fails", async () => {
    setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentification requise" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "Identifiants invalides" }, 401));

    await expect(api.get("/transactions")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never attempts a refresh for a 401 coming from an /auth/* endpoint itself", async () => {
    // A failed login must not trigger the refresh dance — refresh is itself
    // an /auth/* call, so retrying it here would recurse into another 401
    // forever. This is the guard at the top of `request()`
    // (`!path.startsWith("/auth/")`); assert on the recorded call list, not
    // just on the rejection, so a deleted guard fails this test even though
    // the thrown ApiError alone would look identical either way.
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Identifiants invalides" }, 401));

    await expect(
      api.post("/auth/login", { email: "max@example.com", password: "wrong" }),
    ).rejects.toMatchObject({ status: 401, detail: "Identifiants invalides" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain("/api/auth/refresh");
  });

  it("returns undefined for a 204 rather than choking on an empty body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete("/transactions/1")).resolves.toBeUndefined();
  });
});
