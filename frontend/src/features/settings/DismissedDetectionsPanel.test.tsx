import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { DismissedDetectionsPanel } from "./DismissedDetectionsPanel";

const rows = [
  { id: 4, label_key: "cb carrefour market", label: "CB CARREFOUR MARKET",
    created_at: "2026-09-10T10:00:00Z" },
  { id: 7, label_key: "cb decathlon", label: "CB DECATHLON", created_at: "2026-09-12T10:00:00Z" },
];

afterEach(() => vi.restoreAllMocks());

describe("DismissedDetectionsPanel", () => {
  it("lists what was dismissed, readable, with a way back for each", async () => {
    vi.spyOn(api, "get").mockResolvedValue(rows);
    render(<DismissedDetectionsPanel />);
    expect(await screen.findByText("2 libellés écartés")).toBeInTheDocument();
    expect(screen.getByText("CB CARREFOUR MARKET")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rétablir CB DECATHLON" })).toBeInTheDocument();
  });

  it("restores a label through the API and drops its row", async () => {
    vi.spyOn(api, "get").mockResolvedValue(rows);
    const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    render(<DismissedDetectionsPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Rétablir CB DECATHLON" }));
    expect(del).toHaveBeenCalledWith("/recurrences/dismissals/7");
    expect(screen.queryByText("CB DECATHLON")).not.toBeInTheDocument();
    expect(screen.getByText("1 libellé écarté")).toBeInTheDocument();
  });

  it("says when nothing was dismissed", async () => {
    vi.spyOn(api, "get").mockResolvedValue([]);
    render(<DismissedDetectionsPanel />);
    expect(await screen.findByText("Aucun libellé écarté.")).toBeInTheDocument();
  });
});
