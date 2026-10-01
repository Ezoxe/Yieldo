import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { impotsDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { HOURGLASS } from "./geometry";
import { StudyScene } from "./StudyScene";

function renderStudy(onSelect = vi.fn(), detail = impotsDetail) {
  const parts = partReadings(detail, { universe: "study", focus: null });
  const utils = render(
    <StudyScene gauge={gaugeFor(detail.budget)} gaugeTitle="Budget Impôts et taxes" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

function sandHeight(container: HTMLElement): number {
  const sand = container.querySelector(".yd-lens--hourglass [data-sand]");
  return sand === null ? 0 : Number(sand.getAttribute("height"));
}

describe("StudyScene", () => {
  it("draws one lens and one label per part of the study", () => {
    const { container } = renderStudy();
    for (const part of ["hourglass", "cadastre", "tray", "calculator"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Impôt sur le revenu", "Taxe foncière", "Taxe d'habitation", "Autres prélèvements"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("leaves as much sand in the upper bulb as the share of the income-tax budget left", () => {
    const { container, parts } = renderStudy();
    const incomeTax = parts.find((part) => part.part === "hourglass")!;
    const bulb = HOURGLASS.neck - HOURGLASS.top;
    expect(sandHeight(container)).toBeCloseTo(incomeTax.level!.share * bulb, 1);
    expect(sandHeight(container)).toBeGreaterThan(0);
    expect(sandHeight(container)).toBeLessThan(bulb);
  });

  it("empties the upper bulb when the income tax has no level to show", () => {
    const incomeTax = impotsDetail.parts.find((part) => part.slug === "impots-revenu")!;
    const detail = {
      ...impotsDetail,
      parts: impotsDetail.parts.map((part) =>
        part === incomeTax ? { ...part, budget: null, average_cents: null, months_counted: 2 } : part,
      ),
    };
    const { container } = renderStudy(vi.fn(), detail);
    expect(sandHeight(container)).toBe(0);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderStudy();
    await userEvent.click(screen.getByRole("button", { name: /Taxe foncière/ }));
    expect(onSelect).toHaveBeenCalledWith(92);
  });
});
