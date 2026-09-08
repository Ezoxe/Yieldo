import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatAnswer } from "../../lib/types";
import { AnswerProvenance } from "./AnswerProvenance";

function answer(overrides: Partial<ChatAnswer> = {}): ChatAnswer {
  return {
    recognised: true,
    query_description: "Somme des dépenses de mars 2026.",
    text: "Vous avez dépensé 1 284,00 € en mars 2026.",
    amount_cents: -128400,
    is_refusal: false,
    supported_formulations: null,
    chart: null,
    steps: [],
    answered_by: "engines",
    model_name: null,
    model_notice: null,
    ...overrides,
  };
}

describe("who answered", () => {
  // The whole application is the label for its own figures. A badge on every
  // deterministic answer would be noise, and would make the one that matters
  // invisible.
  it("says nothing about an answer Yieldo computed itself", () => {
    const { container } = render(<AnswerProvenance answer={answer()} />);
    expect(container).toBeEmptyDOMElement();
  });

  // "Yieldo measured this" and "your model wrote this" are two different
  // claims, and only the first is one the application stands behind.
  it("names the model that answered, and what that means", () => {
    render(
      <AnswerProvenance
        answer={answer({
          recognised: false,
          answered_by: "modele",
          model_name: "qwen3",
          text: "Vos sorties sont surtout des courses.",
          amount_cents: null,
        })}
      />,
    );

    expect(screen.getByText(/Répondu par votre modèle/)).toBeInTheDocument();
    expect(screen.getByText("qwen3")).toBeInTheDocument();
    expect(screen.getByText(/viennent des moteurs de Yieldo/)).toBeInTheDocument();
    expect(screen.getByText(/Il ne peut rien modifier/)).toBeInTheDocument();
  });

  // A model that failed is a named condition with a remedy, never a silent
  // return to the old behaviour.
  it("names why the model did not take the question", () => {
    const { container } = render(
      <AnswerProvenance
        answer={answer({
          recognised: false,
          is_refusal: true,
          answered_by: "engines",
          model_notice: "Le modèle est injoignable.",
        })}
      />,
    );

    expect(screen.getByText("Le modèle est injoignable.")).toBeInTheDocument();
    expect(container.querySelector(".yd-provenance")).toHaveAttribute("data-source", "echec");
  });
});
