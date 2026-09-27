import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OUTLOOK } from "../avenir/fixtures";
import { NextDaysPanel } from "./NextDaysPanel";

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

function renderPanel() {
  return render(
    <MemoryRouter>
      <NextDaysPanel />
    </MemoryRouter>,
  );
}

describe("NextDaysPanel", () => {
  it("asks for thirty days of the current accounts and leads with the low point", async () => {
    fetchMock.mockResolvedValue(json(OUTLOOK));
    renderPanel();

    expect(await screen.findByText("−184,57 €")).toBeInTheDocument();
    expect(screen.getByText("Découvert probable")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain("scope=checking");
    expect(String(fetchMock.mock.calls[0][0])).toContain("horizon_days=30");
  });

  it("names the next three events and leads to Avenir", async () => {
    fetchMock.mockResolvedValue(json(OUTLOOK));
    renderPanel();

    expect(await screen.findByText("VIR SEPA ACME SAS SALAIRE")).toBeInTheDocument();
    expect(screen.getByText("PRLV SEPA FONCIA LOYER")).toBeInTheDocument();
    expect(screen.queryByText("Solde d'impôt")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Voir l'avenir/ })).toHaveAttribute("href", "/avenir");
  });

  it("prints the refusal it was given, not a zero", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Base indisponible" }, 500));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
