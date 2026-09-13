import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { NetWorthReport } from "../../lib/types";
import { NetWorthPanel } from "./NetWorthPanel";

const report: NetWorthReport = {
  today: {
    taken_on: "2026-09-13",
    assets_cents: 2_390_000,
    debts_cents: 1_157_000,
    net_cents: 1_233_000,
    breakdown: [
      { key: "positions", amount_cents: 1_150_000 },
      { key: "declared", amount_cents: 0 },
      { key: "cash", amount_cents: 1_240_000 },
      { key: "debts", amount_cents: -1_157_000 },
    ],
  },
  history: [
    { taken_on: "2026-09-12", assets_cents: 2_380_000, debts_cents: 1_160_000, net_cents: 1_220_000 },
    { taken_on: "2026-09-13", assets_cents: 2_390_000, debts_cents: 1_157_000, net_cents: 1_233_000 },
  ],
};

function renderPanel(enabled = true) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <NetWorthPanel enabled={enabled} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("NetWorthPanel", () => {
  it("prints assets minus debts, each term named", async () => {
    vi.spyOn(api, "get").mockResolvedValue(report);
    renderPanel();
    // `textContent`, not `toHaveTextContent`: the matcher collapses the
    // non-breaking spaces formatCents writes, and the comparison would then
    // be between two spellings of the same figure.
    const amount = await screen.findByTestId("yd-networth-amount");
    expect(amount.textContent).toBe(formatCents(1_233_000, { signed: true }));
    expect(screen.getByText("Actifs").nextElementSibling?.textContent).toBe(
      formatCents(2_390_000),
    );
    expect(screen.getByText("Dettes").closest("dt")?.nextElementSibling?.textContent).toBe(
      formatCents(1_157_000),
    );
    expect(screen.getByRole("link", { name: "voir" })).toHaveAttribute("href", "/dettes");
  });

  it("says when the line is not yet a line", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ ...report, history: [report.history[1]] });
    renderPanel();
    expect(await screen.findByText(/1 relevé pour l'instant/)).toBeInTheDocument();
  });

  it("waits for the page's own data before asking", () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(report);
    renderPanel(false);
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Chargement du patrimoine net" })).toBeInTheDocument();
  });

  it("prints the backend's refusal rather than a zero", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(503, "Le service est indisponible."));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Le service est indisponible.");
  });
});
