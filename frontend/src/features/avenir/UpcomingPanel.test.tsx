import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OUTLOOK } from "./fixtures";
import { UpcomingPanel } from "./UpcomingPanel";

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

describe("UpcomingPanel", () => {
  it("lists the next thirty days, each line with its source and the balance after it", () => {
    render(<UpcomingPanel outlook={OUTLOOK} onChanged={vi.fn()} />);

    expect(screen.getByText("VIR SEPA ACME SAS SALAIRE")).toBeInTheDocument();
    expect(screen.getByText("Solde d'impôt")).toBeInTheDocument();
    expect(screen.getAllByText("détecté").length).toBeGreaterThan(0);
    expect(screen.getByText("prévu")).toBeInTheDocument();
    expect(screen.getByText(/Dépenses courantes ≈ 34 € par jour/)).toBeInTheDocument();
  });

  it("adds a one-off event and asks the page to reload", async () => {
    const onChanged = vi.fn();
    fetchMock.mockResolvedValue(json({ id: 9 }, 201));
    const user = userEvent.setup();
    render(<UpcomingPanel outlook={OUTLOOK} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "Ajouter un événement prévu" }));
    await user.type(screen.getByLabelText("Libellé"), "Vacances");
    await user.type(screen.getByLabelText("Date"), "2026-10-20");
    await user.type(screen.getByLabelText("Montant (€)"), "1800");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/planned-events");
    expect(JSON.parse(init.body)).toEqual({
      label: "Vacances", due_on: "2026-10-20", amount_cents: -180000,
    });
  });

  it("removes a planned event by its full name", async () => {
    const onChanged = vi.fn();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const user = userEvent.setup();
    render(<UpcomingPanel outlook={OUTLOOK} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "Supprimer l'événement Solde d'impôt" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/planned-events/1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("refuses an amount it cannot read, before any request", async () => {
    const user = userEvent.setup();
    render(<UpcomingPanel outlook={OUTLOOK} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ajouter un événement prévu" }));
    await user.type(screen.getByLabelText("Libellé"), "Vacances");
    await user.type(screen.getByLabelText("Date"), "2026-10-20");
    await user.type(screen.getByLabelText("Montant (€)"), "douze");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Montant illisible");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
