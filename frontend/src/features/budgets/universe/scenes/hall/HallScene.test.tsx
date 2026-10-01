import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { loisirsDetail } from "../../fixtures";
import { gaugeFor, partReadings } from "../../readings";
import { TICKETS } from "./geometry";
import { HallScene } from "./HallScene";

function renderHall(onSelect = vi.fn(), detail = loisirsDetail) {
  const parts = partReadings(detail, { universe: "hall", focus: null });
  const utils = render(
    <HallScene gauge={gaugeFor(detail.budget)} gaugeTitle="Budget Loisirs" parts={parts} onSelect={onSelect} />,
  );
  return { ...utils, parts, onSelect };
}

describe("HallScene", () => {
  it("draws one lens and one label per part of the hall", () => {
    const { container } = renderHall();
    for (const part of ["tickets", "suitcase", "bike", "guitar"]) {
      expect(container.querySelector(`.yd-lens--${part}`)).not.toBeNull();
    }
    const labels = within(screen.getByRole("list"));
    for (const name of ["Sorties et culture", "Sport", "Vacances", "Loisirs et hobbies"]) {
      expect(labels.getByText(name)).toBeInTheDocument();
    }
  });

  it("leaves as many tickets in the book as eighths of the outings budget left", () => {
    const { container, parts } = renderHall();
    const outings = parts.find((part) => part.part === "tickets")!;
    const tickets = container.querySelectorAll('.yd-lens--tickets [data-filled="true"]');
    expect(tickets).toHaveLength(Math.round(outings.level!.share * TICKETS.length));
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.length).toBeLessThan(TICKETS.length);
  });

  it("tears every ticket out when the outings have no level to show", () => {
    const outings = loisirsDetail.parts.find((part) => part.slug === "loisirs-sorties")!;
    const detail = {
      ...loisirsDetail,
      parts: loisirsDetail.parts.map((part) =>
        part === outings ? { ...part, budget: null, average_cents: null, months_counted: 2 } : part,
      ),
    };
    const { container } = renderHall(vi.fn(), detail);
    expect(container.querySelectorAll('.yd-lens--tickets [data-filled="true"]')).toHaveLength(0);
  });

  it("opens a part's page from its label", async () => {
    const { onSelect } = renderHall();
    await userEvent.click(screen.getByRole("button", { name: /Vacances/ }));
    expect(onSelect).toHaveBeenCalledWith(73);
  });
});
