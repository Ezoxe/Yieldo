import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Summary } from "../../lib/types";
import { SetAsidePanel, gapSentence } from "./SetAsidePanel";

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    date_from: "2026-03-01",
    date_to: "2026-03-31",
    inflow_cents: 250_000,
    outflow_cents: -150_000,
    net_cents: 100_000,
    transaction_count: 24,
    savings_rate: 0.4,
    set_aside_cents: 30_000,
    set_aside_gap_cents: 70_000,
    previous: null,
    comparison: null,
    history: null,
    ...overrides,
  };
}

describe("gapSentence", () => {
  it("names what stayed on the current account", () => {
    expect(gapSentence(70_000, 30_000)).toContain("700,00");
    expect(gapSentence(70_000, 30_000)).toContain("compte courant");
  });

  it("says when the savings were funded by drawing the balance down", () => {
    const sentence = gapSentence(-25_000, 120_000);
    expect(sentence).toContain("250,00");
    expect(sentence).toContain("prise sur votre solde");
  });

  it("tells a month that produced nothing from one that moved everything", () => {
    expect(gapSentence(0, 0)).toContain("rien mis de côté");
    expect(gapSentence(0, 90_000)).toContain("à l'euro près");
  });
});

describe("SetAsidePanel", () => {
  it("shows the three figures, each named", () => {
    render(<SetAsidePanel summary={summary()} />);

    expect(screen.getByText("Ce que la période dégage")).toBeInTheDocument();
    expect(screen.getByText("Réellement mis de côté")).toBeInTheDocument();
    expect(screen.getByText("Resté sur le compte courant")).toBeInTheDocument();
  });

  /**
   * The whole reason this panel exists. If the three figures ever read as a
   * sum, the reader would credit themselves 1 300,00 € of capacity on a month
   * that produced 1 000,00 € — the double count `engines/transfer.py` refuses
   * on the backend and this screen must refuse on the front.
   */
  it("separates the figures with a subtraction, never an addition", () => {
    const { container } = render(<SetAsidePanel summary={summary()} />);
    const operators = Array.from(
      container.querySelectorAll(".yd-setaside__operator"),
    ).map((node) => node.textContent);

    expect(operators).toEqual(["−", "="]);
    expect(operators).not.toContain("+");
  });

  it("states the gap in the reader's own words under the figures", () => {
    render(<SetAsidePanel summary={summary()} />);
    expect(screen.getByText(/restés sur votre compte courant/)).toBeInTheDocument();
  });

  it("says the method behind the figure rather than printing it bare", () => {
    render(<SetAsidePanel summary={summary()} />);
    expect(
      screen.getByRole("button", { name: /Comment ce chiffre est mesuré/ }),
    ).toBeInTheDocument();
  });
});
