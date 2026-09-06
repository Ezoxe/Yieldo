import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BalanceBreakdown as Breakdown } from "../../lib/types";
import {
  BalanceBreakdown,
  UNMATCHED_TOLERANCE_CENTS,
  unmatchedSentence,
} from "./BalanceBreakdown";

const body: Breakdown = {
  accounts: [
    {
      id: 1, name: "Compte courant", kind: "checking", liquid: true,
      opening_balance_cents: 412_000, movements_cents: -150_000,
      transaction_count: 214, balance_cents: 262_000,
    },
    {
      id: 3, name: "PEA", kind: "pea", liquid: false,
      opening_balance_cents: 860_000, movements_cents: 0,
      transaction_count: 0, balance_cents: 860_000,
    },
  ],
  liquid_total_cents: 262_000,
  transfers: { count: 0, received_cents: 0, sent_cents: 0, unmatched_cents: 0 },
};

const fetchMock = vi.fn();

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(body));
  vi.stubGlobal("fetch", fetchMock);
});

// The sentence is the whole point of the audit: a lopsided flag does something
// specific to the measured figures, and naming the effect is what lets a reader
// recognise their own symptom in it.
describe("unmatchedSentence", () => {
  it("says nothing when the two legs cancel", () => {
    expect(unmatchedSentence(0)).toBeNull();
  });

  // Not zero: a fee taken on the way or a receipt a cent short is noise, and a
  // warning that fires on 0,03 € is dismissed before the real one is read.
  it("says nothing about a rounding difference", () => {
    expect(unmatchedSentence(UNMATCHED_TOLERANCE_CENTS - 1)).toBeNull();
    expect(unmatchedSentence(-(UNMATCHED_TOLERANCE_CENTS - 1))).toBeNull();
  });

  it("names what an unflagged emission does to the measured figures", () => {
    const sentence = unmatchedSentence(1_200_00);
    // formatCents emits narrow no-break spaces; matched literally rather than normalised.
    expect(sentence).toMatch(/1 200,00/);
    expect(sentence).toMatch(/surestimé/);
    expect(sentence).toMatch(/capacité d'épargne/);
  });

  it("distinguishes the side the flag is missing from", () => {
    expect(unmatchedSentence(1_200_00)).toMatch(/à la réception/);
    expect(unmatchedSentence(-1_200_00)).toMatch(/à l'envoi/);
  });
});

describe("BalanceBreakdown", () => {
  it("shows each account's two halves and what they make", async () => {
    const user = userEvent.setup();
    render(<BalanceBreakdown />);

    await user.click(await screen.findByText("D'où vient ce solde"));

    const row = screen.getByRole("row", { name: /Compte courant/ });
    expect(row).toHaveTextContent("+4 120,00");
    expect(row).toHaveTextContent("−1 500,00");
    expect(row).toHaveTextContent("214 opérations");
    expect(row).toHaveTextContent("+2 620,00");
  });

  // Listed, never hidden: an account left off the table reads as a missing
  // account rather than an excluded one.
  it("lists a non-liquid account and says it is out of the total", async () => {
    const user = userEvent.setup();
    render(<BalanceBreakdown />);

    await user.click(await screen.findByText("D'où vient ce solde"));

    expect(screen.getByRole("row", { name: /PEA/ })).toHaveTextContent(
      "hors solde disponible",
    );
  });

  it("points at the opening balance as the figure to correct", async () => {
    const user = userEvent.setup();
    render(<BalanceBreakdown />);

    await user.click(await screen.findByText("D'où vient ce solde"));

    expect(screen.getByText(/compté deux fois/)).toHaveTextContent("Réglages → Comptes");
  });

  it("raises the transfer audit only when the legs do not cancel", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...body,
        transfers: {
          count: 94, received_cents: 1_200_00, sent_cents: 0, unmatched_cents: 1_200_00,
        },
      }),
    );
    render(<BalanceBreakdown />);

    await user.click(await screen.findByText("D'où vient ce solde"));

    expect(screen.getByRole("status")).toHaveTextContent(/surestimé/);
  });

  // Reported, never swallowed -- but as a status and not an alert: the solde
  // above is fine, and only its working-out failed to load.
  it("surfaces a refusal rather than showing an empty table", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Compte introuvable" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<BalanceBreakdown />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Le détail du solde n'a pas pu être chargé : Compte introuvable",
    );
  });
});
