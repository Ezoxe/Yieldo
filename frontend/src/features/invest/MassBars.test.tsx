import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MassBars } from "./MassBars";

const MASS = { acheter: 3_497, vendre: 2_907, "ne rien faire": 3_596 };

describe("MassBars", () => {
  it("draws one bar per option with its share, and marks the chosen one", () => {
    render(<MassBars mass={MASS} chosen="ne rien faire" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[2]).getByText("ne rien faire")).toBeInTheDocument();
    expect(items[2]).toHaveTextContent("36 %");
    expect(items[2]).toHaveAttribute("aria-current", "true");
    expect(items[0]).not.toHaveAttribute("aria-current");
    // The tick carries the state, not the colour alone.
    expect(within(items[2]).getByLabelText("réponse retenue")).toBeInTheDocument();
  });

  it("sizes each bar by its share of the whole", () => {
    render(<MassBars mass={MASS} chosen={null} />);
    const bars = document.querySelectorAll<HTMLElement>(".yd-mass__fill");
    expect(bars[0].style.inlineSize).toBe("34.97%");
    expect(bars[2].style.inlineSize).toBe("35.96%");
  });

  it("keeps the order it was given, so levels read 0 to 10", () => {
    const levels = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), 909]));
    render(<MassBars mass={levels} chosen="4" />);
    const labels = screen.getAllByRole("listitem").map((item) => item.textContent?.slice(0, 2));
    expect(labels[0]).toMatch(/^0/);
    expect(labels[10]).toMatch(/^10/);
  });

  it("uses the labels it is handed instead of the raw keys", () => {
    render(
      <MassBars mass={{ true: 2_890, false: 7_110 }} chosen={null}
                labels={{ true: "Se poursuit", false: "S'inverse" }} />,
    );
    expect(screen.getByText("Se poursuit")).toBeInTheDocument();
    expect(screen.getByText("S'inverse")).toBeInTheDocument();
  });
});
