import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { alimentationDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { FRIDGE_SLOTS } from "./geometry";
import { KitchenScene } from "./KitchenScene";

function renderKitchen(onSelect = vi.fn()) {
  const parts = partReadings(alimentationDetail, { universe: "kitchen", focus: null });
  const utils = render(
    <KitchenScene gauge={gaugeFor(alimentationDetail.budget)} gaugeTitle="Budget Alimentation" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

describe("KitchenScene", () => {
  it("draws one lens and one label per part of the kitchen", () => {
    const { container } = renderKitchen();
    for (const part of ["fridge", "delivery", "coffee", "plate"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Courses", "Restaurants", "Livraison", "Cafés et bars"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("fills as many fridge places as twelfths of the groceries budget left", () => {
    const { container, parts } = renderKitchen();
    const fridge = parts.find((part) => part.part === "fridge")!;
    const filled = container.querySelectorAll('.yd-lens--fridge [data-filled="true"]');
    expect(filled).toHaveLength(Math.round(fridge.level!.share * FRIDGE_SLOTS.length));
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderKitchen();
    await userEvent.click(screen.getByRole("button", { name: /Restaurants/ }));
    expect(onSelect).toHaveBeenCalledWith(22);
  });
});
