import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PipelineFunnel } from "./PipelineFunnel";

const STAGES = [
  { outcome: "skipped" as const, count: 6 },
  { outcome: "held" as const, count: 10 },
  { outcome: "refused" as const, count: 2 },
  { outcome: "ordered" as const, count: 2 },
  { outcome: "failed" as const, count: 0 },
];

describe("PipelineFunnel", () => {
  it("names every stage in French, so colour is never the only channel", () => {
    render(<PipelineFunnel examined={20} stages={STAGES} />);
    for (const label of [
      "Écarté avant le modèle",
      "Aucune action",
      "Refusé par le mandat",
      "Ordre transmis",
      "En échec",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows the count and the share of every stage", () => {
    render(<PipelineFunnel examined={20} stages={STAGES} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]).getByText("10")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/50/)).toBeInTheDocument();
  });

  it("scales every bar against what was examined, not against the largest stage", () => {
    render(<PipelineFunnel examined={20} stages={STAGES} />);
    const rows = screen.getAllByRole("listitem");
    // 10 of 20 is half the track, not the whole of it.
    const bar = rows[1].querySelector(".yd-funnel__bar") as HTMLElement;
    expect(bar.style.inlineSize).toBe("50%");
  });

  it("keeps a stage that held nothing in the list rather than dropping it", () => {
    render(<PipelineFunnel examined={20} stages={STAGES} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(rows[4]).getByText("0")).toBeInTheDocument();
  });

  it("describes each bar for a reader who cannot see it", () => {
    render(<PipelineFunnel examined={20} stages={STAGES} />);
    expect(screen.getByRole("img", { name: "10 sur 20, soit 50 %" })).toBeInTheDocument();
  });

  it("draws nothing at all for a stage that held nothing", () => {
    // The bar has a two-pixel minimum so a real but tiny stage stays visible,
    // and that minimum turned zero into a mark claiming a stage had happened.
    render(<PipelineFunnel examined={20} stages={STAGES} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[4].querySelector(".yd-funnel__bar")).toBeNull();
    expect(rows[1].querySelector(".yd-funnel__bar")).not.toBeNull();
  });

  it("does not divide by zero on a pipeline that has examined nothing", () => {
    render(
      <PipelineFunnel
        examined={0}
        stages={[{ outcome: "skipped" as const, count: 0 }]}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(row.querySelector(".yd-funnel__bar")).toBeNull();
    expect(within(row).getByText("0")).toBeInTheDocument();
  });
});
