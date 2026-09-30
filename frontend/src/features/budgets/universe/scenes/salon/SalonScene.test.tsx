import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { abonnementsDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { PROGRESS } from "./geometry";
import { SalonScene } from "./SalonScene";

function renderSalon(onSelect = vi.fn()) {
  const parts = partReadings(abonnementsDetail, { universe: "salon", focus: null });
  const utils = render(
    <SalonScene gauge={gaugeFor(abonnementsDetail.budget)} gaugeTitle="Budget Abonnements" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

describe("SalonScene", () => {
  it("draws one lens and one label per subscription", () => {
    const { container } = renderSalon();
    for (const part of ["tv", "laptop", "press", "gym"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Streaming", "Logiciels et services", "Presse", "Salle de sport"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("fills the television's progress bar to the share of the streaming budget left", () => {
    const { container, parts } = renderSalon();
    const tv = parts.find((part) => part.part === "tv")!;
    const bar = container.querySelector(".yd-lens__progress");
    expect(Number(bar?.getAttribute("width"))).toBeCloseTo(tv.level!.share * PROGRESS.width, 5);
  });

  it("opens a subscription's page from its label", async () => {
    const { onSelect } = renderSalon();
    await userEvent.click(screen.getByRole("button", { name: /Salle de sport/ }));
    expect(onSelect).toHaveBeenCalledWith(44);
  });
});
