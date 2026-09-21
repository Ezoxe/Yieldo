import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { InvestDecisionDetail } from "../../lib/types";
import { DecisionDetail } from "./DecisionDetail";

function detail(overrides: Partial<InvestDecisionDetail> = {}): InvestDecisionDetail {
  return {
    id: 12, run_id: "r", symbol: "BTC-EUR", mode: "paper", provider: "laya",
    model: "laya-typed-decisions", outcome: "held", rule: "hold",
    message: "Le modèle ne propose aucune action sur cet instrument.",
    reference_price_cents: 42_165, latency_ms: 700, created_at: "2026-09-21T09:31:00Z",
    features: { symbol: "BTC-EUR", closes_seen: 120 },
    answers: {
      direction: {
        question_key: "direction", kind: "choice", choice: "acheter", score_value: null,
        probability_bps: null, confidence_bps: 39, latency_ms: 245, provider: "laya",
        model: "laya-typed-decisions",
        mass_bps: { acheter: 3_497, vendre: 2_907, "ne rien faire": 3_596 }, act_bps: 10_000,
      },
      conviction: {
        question_key: "conviction", kind: "score", choice: null, score_value: 4,
        probability_bps: null, confidence_bps: 402, latency_ms: 230, provider: "laya",
        model: "laya-typed-decisions",
        mass_bps: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), 909])),
      },
      continuation: {
        question_key: "continuation", kind: "probability", choice: null, score_value: null,
        probability_bps: 2_890, confidence_bps: 7_110, latency_ms: 225, provider: "laya",
        model: "laya-typed-decisions",
      },
    },
    inputs_hash: "x".repeat(64),
    windows: {}, context: {},
    questions: [
      { key: "direction", kind: "choice", prompt: "Quelle action ?",
        options: ["acheter", "vendre", "ne rien faire"] },
      { key: "conviction", kind: "score", prompt: "Nette ?", minimum: 0, maximum: 10 },
      { key: "continuation", kind: "probability", statement: "Le mouvement se poursuit." },
    ],
    risk_verdict: null, order: null,
    second_opinion: {
      direction: { question_key: "direction", kind: "choice", choice: "ne rien faire",
                   score_value: null, probability_bps: null },
    },
    ...overrides,
  };
}

describe("DecisionDetail — the model's whole answer", () => {
  it("draws the mass under a choice, with the chosen option ticked", () => {
    render(<DecisionDetail detail={detail()} />);
    const lists = screen.getAllByRole("list", { name: "Répartition de la masse de probabilité" });
    const direction = lists[0];
    expect(within(direction).getAllByRole("listitem")).toHaveLength(3);
    expect(within(direction).getByText("acheter").closest("li")).toHaveAttribute("aria-current", "true");
    expect(direction).toHaveTextContent("35 %");
  });

  it("draws eleven levels under a score and two sides under a probability", () => {
    render(<DecisionDetail detail={detail()} />);
    const lists = screen.getAllByRole("list", { name: "Répartition de la masse de probabilité" });
    expect(within(lists[1]).getAllByRole("listitem")).toHaveLength(11);
    expect(within(lists[1]).getByText("4").closest("li")).toHaveAttribute("aria-current", "true");
    const continuation = lists[2];
    expect(within(continuation).getByText("Se poursuit").closest("li")).toHaveTextContent("29 %");
    expect(within(continuation).getByText("S'inverse").closest("li")).toHaveTextContent("71 %");
  });

  it("prints the act probability beside the answer", () => {
    render(<DecisionDetail detail={detail()} />);
    expect(screen.getByText(/agir/)).toHaveTextContent("100 %");
  });

  it("prints what the rules would have said, and whether they agreed", () => {
    render(<DecisionDetail detail={detail()} />);
    const pill = screen.getByText(/Les règles auraient dit/);
    expect(pill).toHaveTextContent("ne rien faire");
    expect(pill).toHaveClass("yd-pill--warning");
  });

  it("marks agreement when the rules said the same", () => {
    const agreeing = detail({
      second_opinion: {
        direction: { question_key: "direction", kind: "choice", choice: "acheter",
                     score_value: null, probability_bps: null },
      },
    });
    render(<DecisionDetail detail={agreeing} />);
    expect(screen.getByText(/Les règles auraient dit/)).toHaveClass("yd-pill--positive");
  });

  it("says nothing about the rules when there is no second opinion", () => {
    render(<DecisionDetail detail={detail({ second_opinion: null })} />);
    expect(screen.queryByText(/Les règles auraient dit/)).not.toBeInTheDocument();
  });

  it("draws no mass for an answer that has none", () => {
    const plain = detail();
    plain.answers.direction.mass_bps = null;
    plain.answers.conviction.mass_bps = undefined;
    plain.answers.continuation.probability_bps = null;
    render(<DecisionDetail detail={plain} />);
    expect(screen.queryByRole("list", { name: "Répartition de la masse de probabilité" }))
      .not.toBeInTheDocument();
  });
});
