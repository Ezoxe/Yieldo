import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { achatsDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { DressingScene } from "./DressingScene";
import { HANGERS } from "./geometry";

function renderDressing(onSelect = vi.fn(), detail = achatsDetail) {
  const parts = partReadings(detail, { universe: "dressing", focus: null });
  const utils = render(
    <DressingScene gauge={gaugeFor(detail.budget)} gaugeTitle="Budget Achats" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

describe("DressingScene", () => {
  it("draws one lens and one label per part of the dressing room", () => {
    const { container } = renderDressing();
    for (const part of ["wardrobe", "tech", "lamp", "gifts"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Vêtements", "Équipement et high-tech", "Maison et décoration", "Cadeaux"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("dresses as many hangers as eighths of the clothing budget left", () => {
    const { container, parts } = renderDressing();
    const clothing = parts.find((part) => part.part === "wardrobe")!;
    const dressed = container.querySelectorAll('.yd-lens--wardrobe [data-filled="true"]');
    expect(dressed).toHaveLength(Math.round(clothing.level!.share * HANGERS.length));
    expect(dressed.length).toBeGreaterThan(0);
    expect(dressed.length).toBeLessThan(HANGERS.length);
  });

  it("leaves every hanger bare when the clothing has no level to show", () => {
    const clothing = achatsDetail.parts.find((part) => part.slug === "achats-vetements")!;
    const detail = {
      ...achatsDetail,
      parts: achatsDetail.parts.map((part) =>
        part === clothing ? { ...part, budget: null, average_cents: null, months_counted: 2 } : part,
      ),
    };
    const { container } = renderDressing(vi.fn(), detail);
    expect(container.querySelectorAll('.yd-lens--wardrobe [data-filled="true"]')).toHaveLength(0);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderDressing();
    await userEvent.click(screen.getByRole("button", { name: /Cadeaux/ }));
    expect(onSelect).toHaveBeenCalledWith(84);
  });
});
