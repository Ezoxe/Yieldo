import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { bandFor, ScoreGauge } from "./ScoreGauge";

// The boundaries, not the drawing. They are the engine's own bands, and the
// only thing that turns a number into a reading a person can act on.
describe("bandFor", () => {
  it("reads anything under 40 as fragile", () => {
    expect(bandFor(0).label).toBe("Fragile");
    expect(bandFor(39).label).toBe("Fragile");
  });

  it("reads 40 to 69 as balanced", () => {
    expect(bandFor(40).label).toBe("Équilibré");
    expect(bandFor(69).label).toBe("Équilibré");
  });

  it("reads 70 and above as solid", () => {
    expect(bandFor(70).label).toBe("Solide");
    expect(bandFor(100).label).toBe("Solide");
  });
});

describe("ScoreGauge", () => {
  it("shows the measurement and the word that reads it", () => {
    render(<ScoreGauge score={32} />);

    expect(screen.getByTestId("yd-health-score")).toHaveTextContent("32");
    expect(screen.getByText("sur 100")).toBeInTheDocument();
    // Never colour alone: the band is stated in words (WCAG 1.4.1).
    expect(screen.getByText("Fragile")).toBeInTheDocument();
  });

  it("fills more of the arc for a higher score", () => {
    const { container: low } = render(<ScoreGauge score={20} />);
    const { container: high } = render(<ScoreGauge score={80} />);

    const dashOf = (root: HTMLElement) =>
      Number(
        (root.querySelector(".yd-gauge__fill") as SVGElement)
          .getAttribute("stroke-dasharray")!
          .split(" ")[0],
      );

    expect(dashOf(high)).toBeGreaterThan(dashOf(low));
  });

  // A score outside 0-100 is a backend fault, not a reason to draw an arc
  // longer than the ring it sits on.
  it("never draws past the end of the scale", () => {
    const { container } = render(<ScoreGauge score={140} />);
    const [filled, ...rest] = (container.querySelector(".yd-gauge__fill") as SVGElement)
      .getAttribute("stroke-dasharray")!
      .split(" ")
      .map(Number);
    const track = Number(
      (container.querySelector(".yd-gauge__track") as SVGElement)
        .getAttribute("stroke-dasharray")!
        .split(" ")[0],
    );

    expect(rest.length).toBe(1);
    expect(filled).toBeLessThanOrEqual(track);
  });
});
