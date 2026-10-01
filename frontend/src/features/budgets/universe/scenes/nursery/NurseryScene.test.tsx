import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { familleDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { MILK } from "./geometry";
import { NurseryScene } from "./NurseryScene";

function renderNursery(onSelect = vi.fn(), detail = familleDetail) {
  const parts = partReadings(detail, { universe: "nursery", focus: null });
  const utils = render(
    <NurseryScene gauge={gaugeFor(detail.budget)} gaugeTitle="Budget Famille" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

function milkHeight(container: HTMLElement): number {
  const milk = container.querySelector(".yd-lens--bottle [data-milk]");
  return milk === null ? 0 : Number(milk.getAttribute("height"));
}

describe("NurseryScene", () => {
  it("draws one lens and one label per part of the nursery", () => {
    const { container } = renderNursery();
    for (const part of ["bottle", "satchel", "basket"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Garde d'enfants", "Scolarité", "Animaux"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("fills the bottle as far as the share of the childcare budget left", () => {
    const { container, parts } = renderNursery();
    const childcare = parts.find((part) => part.part === "bottle")!;
    const span = MILK.bottom - MILK.top;
    expect(milkHeight(container)).toBeCloseTo(childcare.level!.share * span, 1);
    expect(milkHeight(container)).toBeGreaterThan(0);
    expect(milkHeight(container)).toBeLessThan(span);
  });

  it("empties the bottle when the childcare has no level to show", () => {
    const childcare = familleDetail.parts.find((part) => part.slug === "famille-garde")!;
    const detail = {
      ...familleDetail,
      parts: familleDetail.parts.map((part) =>
        part === childcare ? { ...part, budget: null, average_cents: null, months_counted: 2 } : part,
      ),
    };
    const { container } = renderNursery(vi.fn(), detail);
    expect(milkHeight(container)).toBe(0);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderNursery();
    await userEvent.click(screen.getByRole("button", { name: /Animaux/ }));
    expect(onSelect).toHaveBeenCalledWith(103);
  });
});
