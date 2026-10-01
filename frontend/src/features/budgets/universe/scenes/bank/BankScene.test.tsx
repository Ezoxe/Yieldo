import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fraisDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { BankScene } from "./BankScene";
import { NOTES } from "./geometry";

function renderBank(onSelect = vi.fn(), detail = fraisDetail) {
  const parts = partReadings(detail, { universe: "bank", focus: null });
  const utils = render(
    <BankScene gauge={gaugeFor(detail.budget)} gaugeTitle="Budget Frais bancaires" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

function notesHeight(container: HTMLElement): number {
  const notes = container.querySelector(".yd-lens--cassette [data-notes]");
  return notes === null ? 0 : Number(notes.getAttribute("height"));
}

describe("BankScene", () => {
  it("draws one lens and one label per part of the bank", () => {
    const { container } = renderBank();
    for (const part of ["cassette", "statement", "vault"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Frais de tenue de compte", "Agios et incidents", "Cotisation carte"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("stacks as many notes in the cassette as the share of the card budget left", () => {
    const { container, parts } = renderBank();
    const card = parts.find((part) => part.part === "cassette")!;
    const span = NOTES.bottom - NOTES.top;
    expect(notesHeight(container)).toBeCloseTo(card.level!.share * span, 1);
    expect(notesHeight(container)).toBeGreaterThan(0);
    expect(notesHeight(container)).toBeLessThan(span);
  });

  it("empties the cassette when the card has no level to show", () => {
    const card = fraisDetail.parts.find((part) => part.slug === "frais-carte")!;
    const detail = {
      ...fraisDetail,
      parts: fraisDetail.parts.map((part) =>
        part === card ? { ...part, budget: null, average_cents: null, months_counted: 2 } : part,
      ),
    };
    const { container } = renderBank(vi.fn(), detail);
    expect(notesHeight(container)).toBe(0);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderBank();
    await userEvent.click(screen.getByRole("button", { name: /Agios et incidents/ }));
    expect(onSelect).toHaveBeenCalledWith(112);
  });
});
