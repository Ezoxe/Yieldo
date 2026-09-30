import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { logementChildDetail, logementDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { HouseScene } from "./HouseScene";

function renderHouse(onSelect = vi.fn()) {
  const parts = partReadings(logementDetail, { universe: "house", focus: null });
  const utils = render(
    <HouseScene gauge={gaugeFor(logementDetail.budget)} gaugeTitle="Budget Logement" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

describe("HouseScene", () => {
  it("draws one lens and one label per part of the house", () => {
    const { container } = renderHouse();
    for (const part of ["roof", "door", "net", "power", "water", "workshop"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Loyer", "Énergie", "Internet et téléphone", "Assurance habitation", "Charges et copropriété", "Travaux et entretien"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
    // Rent and mortgage share the door: the one actually paid is drawn.
    expect(labels.queryByText("Crédit immobilier")).toBeNull();
  });

  it("lights as many meter bars as fifths of the energy budget left", () => {
    const { container, parts } = renderHouse();
    const power = parts.find((part) => part.part === "power")!;
    const lit = container.querySelectorAll('.yd-lens--power [data-lit="true"]');
    expect(lit).toHaveLength(Math.round(power.level!.share * 5));
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderHouse();
    await userEvent.click(screen.getByRole("button", { name: /Internet et téléphone/ }));
    expect(onSelect).toHaveBeenCalledWith(15);
  });

  it("puts a child in front of its house", () => {
    const energy = logementChildDetail(14)!;
    const { container } = render(
      <HouseScene
        gauge={gaugeFor(energy.budget)}
        gaugeTitle="Budget Énergie"
        parts={partReadings(energy, { universe: "house", focus: "power" })}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector(".yd-lens--power.yd-lens--focused")).not.toBeNull();
    expect(container.querySelector(".yd-lens--door.yd-lens--dimmed")).not.toBeNull();
  });
});
