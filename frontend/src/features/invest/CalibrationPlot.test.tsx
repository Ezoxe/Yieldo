import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalibrationPlot } from "./CalibrationPlot";

const BUCKETS = [
  { lower_bps: 5_000, upper_bps: 6_000, count: 12, stated_bps: 5_500, observed_bps: 5_000,
    gap_bps: -500 },
  { lower_bps: 7_000, upper_bps: 8_000, count: 40, stated_bps: 7_000, observed_bps: 7_000,
    gap_bps: 0 },
  { lower_bps: 9_000, upper_bps: 10_000, count: 4, stated_bps: 9_200, observed_bps: 5_000,
    gap_bps: -4_200 },
];

describe("CalibrationPlot", () => {
  it("draws one dot per band", () => {
    const { container } = render(<CalibrationPlot buckets={BUCKETS} />);
    expect(container.querySelectorAll(".yd-calib__dot")).toHaveLength(3);
  });

  it("sizes a dot by how many decisions are behind it", () => {
    const { container } = render(<CalibrationPlot buckets={BUCKETS} />);
    const radii = [...container.querySelectorAll(".yd-calib__dot")].map((dot) =>
      Number(dot.getAttribute("r")),
    );
    // Forty decisions must not look like four.
    expect(radii[1]).toBeGreaterThan(radii[2]);
  });

  it("puts a well-calibrated band on the diagonal", () => {
    const { container } = render(<CalibrationPlot buckets={BUCKETS} />);
    const perfect = container.querySelectorAll(".yd-calib__dot")[1];
    const cx = Number(perfect.getAttribute("cx"));
    const cy = Number(perfect.getAttribute("cy"));
    // x and y are mirrored about the square's centre when stated == observed.
    expect(cx + cy).toBeCloseTo(100, 5);
  });

  it("repeats every figure in a table, where the counts are readable", () => {
    render(<CalibrationPlot buckets={BUCKETS} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    // One header row plus one per band.
    expect(rows).toHaveLength(4);
    expect(within(rows[2]).getByText("40")).toBeInTheDocument();
  });

  it("signs the gap, because the direction of the error is the point", () => {
    render(<CalibrationPlot buckets={BUCKETS} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[3]).getByText(/−42/)).toBeInTheDocument();
  });

  it("describes itself, and names the diagonal in words rather than in a legend", () => {
    render(<CalibrationPlot buckets={BUCKETS} />);
    expect(screen.getByRole("img", { name: /diagonale est la calibration parfaite/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/trop prudent/)).toBeInTheDocument();
  });
});
