import { describe, expect, it } from "vitest";

import {
  AGENT_ROUTES,
  SESSION_ONLY_ROUTES,
  buildAgentBrief,
  isLocalOrigin,
} from "./agentBrief";

const INPUT = {
  key: "yld_a1b2c3d4_e5f6a7b8c9d0e1f2",
  expiresAt: "2026-09-05T15:42:00Z",
  origin: "https://yieldo.chez-moi.fr",
};

describe("buildAgentBrief", () => {
  it("carries the key and the header it goes in", () => {
    const brief = buildAgentBrief(INPUT);
    expect(brief).toContain(`Authorization: Bearer ${INPUT.key}`);
  });

  it("states the base URL, so nothing has to be guessed", () => {
    expect(buildAgentBrief(INPUT)).toContain("https://yieldo.chez-moi.fr");
  });

  it("says when the key dies, in words rather than an ISO string", () => {
    const brief = buildAgentBrief(INPUT);
    expect(brief).toMatch(/5 septembre 2026/);
    expect(brief).toContain("24 heures");
  });

  it("never carries a password, and says none exists", () => {
    // The whole reason this file has a test: the block is meant to be pasted
    // into a third-party agent. A password in it would hand over the one
    // thing the key deliberately cannot do — lock the operator out.
    const brief = buildAgentBrief(INPUT).toLowerCase();
    expect(brief).not.toMatch(/mot de passe\s*:/);
    expect(brief).toContain("tu ne dois jamais en demander");
  });

  it("names the routes the key does not open", () => {
    const brief = buildAgentBrief(INPUT);
    for (const route of SESSION_ONLY_ROUTES) expect(brief).toContain(route);
  });

  it("points at the document the server serves for everything else", () => {
    const brief = buildAgentBrief(INPUT);
    expect(brief).toContain("/api/openapi.json");
  });

  it("states the money convention in the terms the whole codebase uses", () => {
    // An agent that sends euros as a float corrupts the ledger silently.
    const brief = buildAgentBrief(INPUT);
    expect(brief).toContain("amount_cents");
    expect(brief).toContain("ENTIER DE CENTIMES");
  });

  it("warns that a local address is unreachable from elsewhere", () => {
    const local = buildAgentBrief({ ...INPUT, origin: "http://localhost:5173" });
    expect(local).toContain("adresse est locale");
    expect(buildAgentBrief(INPUT)).not.toContain("adresse est locale");
  });

  it("prints every declared route with its own parameters", () => {
    const brief = buildAgentBrief(INPUT);
    for (const route of AGENT_ROUTES) expect(brief).toContain(route.path);
    expect(brief).toContain("uncategorized_only");
  });
});

describe("AGENT_ROUTES", () => {
  it("names only /api routes, and names each one once", () => {
    // A brief that sent an agent to a route that does not exist would make
    // Yieldo look broken. The paths here are taken from the OpenAPI document.
    const paths = AGENT_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(paths).size).toBe(paths.length);
    for (const route of AGENT_ROUTES) expect(route.path.startsWith("/api/")).toBe(true);
  });
});

describe("isLocalOrigin", () => {
  it("recognises the addresses only this machine can reach", () => {
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:8000")).toBe(true);
    expect(isLocalOrigin("https://yieldo.chez-moi.fr")).toBe(false);
    // Not a local address, whatever the name suggests.
    expect(isLocalOrigin("https://localhost.example.com")).toBe(false);
  });
});
