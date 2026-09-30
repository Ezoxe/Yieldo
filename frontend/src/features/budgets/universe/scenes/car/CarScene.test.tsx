import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { formatCents } from "../../../../../design/theme";
import { fuelDetail, transportDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { CarScene } from "./CarScene";

function renderFamily(onSelect = vi.fn()) {
  const utils = render(
    <CarScene
      gauge={gaugeFor(transportDetail.budget)}
      gaugeTitle="Budget Transport"
      parts={partReadings(transportDetail, { universe: "car", focus: null })}
      onSelect={onSelect}
    />,
  );
  return { ...utils, onSelect };
}

describe("CarScene", () => {
  it("draws one lens and one label per part the car has", () => {
    const { container } = renderFamily();
    for (const part of ["fuel", "engine", "cage", "toll"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Carburant", "Entretien véhicule", "Assurance véhicule", "Péage et stationnement"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
    // Transports en commun and Billets et voyages have no part in the car.
    expect(labels.queryByText("Transports en commun")).toBeNull();
  });

  it("says each part's figure beside its name", () => {
    renderFamily();
    const fuel = transportDetail.parts.find((part) => part.slug === "transport-carburant")!;
    const label = screen.getByRole("button", { name: /Carburant/ });
    // textContent, not toHaveTextContent: the matcher folds the no-break
    // space formatCents puts before « € » and would then never match it.
    expect(label.textContent).toContain(formatCents(Math.abs(fuel.spent_cents)));
    expect(label.textContent).toContain(`reste ${formatCents(fuel.budget!.remaining_cents)}`);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderFamily();
    await userEvent.click(screen.getByRole("button", { name: /Péage et stationnement/ }));
    expect(onSelect).toHaveBeenCalledWith(34);
  });

  it("gives the gauge a label of its own and no gauge without a ceiling", () => {
    const { container, unmount } = renderFamily();
    expect(container.querySelector(".yd-dial")).not.toBeNull();
    expect(screen.getByText("Budget Transport")).toBeInTheDocument();
    unmount();

    const { container: bare } = render(
      <CarScene gauge={null} gaugeTitle="Budget Transport" parts={[]} onSelect={vi.fn()} />,
    );
    expect(bare.querySelector(".yd-dial")).toBeNull();
    expect(screen.queryByText("Budget Transport")).toBeNull();
  });

  it("lowers the fuel to its true level", () => {
    const { container } = renderFamily();
    const fuel = container.querySelector<HTMLElement>(".yd-lens__fuel");
    const reading = partReadings(transportDetail, { universe: "car", focus: null }).find((part) => part.part === "fuel")!;
    const drop = (1 - reading.level!.share) * 24;
    expect(fuel?.style.getPropertyValue("--drop")).toBe(`${drop}px`);
  });

  it("draws no fuel at all when the tank has no level to show", () => {
    const parts = partReadings(transportDetail, { universe: "car", focus: null }).map((part) =>
      part.part === "fuel" ? { ...part, level: null } : part,
    );
    const { container } = render(<CarScene gauge={null} gaugeTitle="" parts={parts} onSelect={vi.fn()} />);
    expect(container.querySelector(".yd-lens__fuel")).toBeNull();
    expect(container.querySelector(".yd-lens--fuel")).not.toBeNull();
  });

  it("puts a child's part in front and the rest of the family behind it", () => {
    render(
      <CarScene
        gauge={gaugeFor(fuelDetail.budget)}
        gaugeTitle="Budget Carburant"
        parts={partReadings(fuelDetail, { universe: "car", focus: "fuel" })}
        onSelect={vi.fn()}
      />,
    );
    const current = screen.getByText("Carburant").closest("[aria-current]");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: /Carburant/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Entretien véhicule/ }).closest("li")).toHaveClass(
      "yd-scene-label--dimmed",
    );
  });
});
