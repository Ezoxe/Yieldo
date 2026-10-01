import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { santeDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { BLISTER_PILLS } from "./geometry";
import { ClinicScene } from "./ClinicScene";

function renderClinic(onSelect = vi.fn(), detail = santeDetail) {
  const parts = partReadings(detail, { universe: "clinic", focus: null });
  const utils = render(
    <ClinicScene gauge={gaugeFor(detail.budget)} gaugeTitle="Budget Santé" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

describe("ClinicScene", () => {
  it("draws one lens and one label per part of the office", () => {
    const { container } = renderClinic();
    for (const part of ["medicine", "stethoscope", "reader", "glasses"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Consultations", "Pharmacie", "Mutuelle", "Optique et dentaire"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("leaves as many pills in the blister as tenths of the pharmacy budget left", () => {
    const { container, parts } = renderClinic();
    const pharmacy = parts.find((part) => part.part === "medicine")!;
    const pills = container.querySelectorAll('.yd-lens--medicine [data-filled="true"]');
    expect(pills).toHaveLength(Math.round(pharmacy.level!.share * BLISTER_PILLS.length));
    expect(pills.length).toBeGreaterThan(0);
    expect(pills.length).toBeLessThan(BLISTER_PILLS.length);
  });

  it("empties the blister when the pharmacy has no level to show", () => {
    const pharmacy = santeDetail.parts.find((part) => part.slug === "sante-pharmacie")!;
    const detail = {
      ...santeDetail,
      parts: santeDetail.parts.map((part) =>
        part === pharmacy ? { ...part, budget: null, average_cents: null, months_counted: 2 } : part,
      ),
    };
    const { container } = renderClinic(vi.fn(), detail);
    expect(container.querySelectorAll('.yd-lens--medicine [data-filled="true"]')).toHaveLength(0);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderClinic();
    await userEvent.click(screen.getByRole("button", { name: /Mutuelle/ }));
    expect(onSelect).toHaveBeenCalledWith(63);
  });
});
