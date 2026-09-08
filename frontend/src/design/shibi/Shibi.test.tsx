import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Shibi } from "./Shibi";
import { SHIBI_SIZE } from "./sprite";
import { useShibiPreference, useShibiVisible } from "./shibiPreference";

afterEach(() => {
  useShibiPreference.setState({ hidden: false });
  try {
    localStorage.clear();
  } catch {
    // A browser that refuses storage is not a broken test.
  }
});

describe("Shibi", () => {
  it("sizes its canvas by a whole multiple of the 32-pixel grid", () => {
    const { container } = render(<Shibi scale={3} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(SHIBI_SIZE * 3);
    expect(canvas.height).toBe(SHIBI_SIZE * 3);
  });

  // A pixel sprite at 1.5x has half its pixels two device pixels wide and half
  // of them three, which is the one way to make pixel art look like a mistake.
  it("refuses a fractional scale by rounding it to a whole one", () => {
    const { container } = render(<Shibi scale={1.5} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width % SHIBI_SIZE).toBe(0);
  });

  it("stays out of the accessibility tree unless it is given something to say", () => {
    const { container, rerender } = render(<Shibi />);
    expect(container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");

    rerender(<Shibi label="Le shibi réfléchit" state="reflexion" />);
    expect(screen.getByRole("img", { name: "Le shibi réfléchit" })).toBeInTheDocument();
  });

  it("carries the state it is in, so a stylesheet and a test can both see it", () => {
    const { container } = render(<Shibi state="erreur" />);
    expect(container.querySelector("canvas")).toHaveAttribute("data-state", "erreur");
  });
});

describe("the Réglages switch", () => {
  // Held the wrong way round on purpose: absent means shown, so a household
  // that never opens Réglages still meets him.
  it("shows him until somebody says otherwise", () => {
    let visible: boolean | null = null;
    function Probe() {
      visible = useShibiVisible();
      return null;
    }
    render(<Probe />);
    expect(visible).toBe(true);

    act(() => useShibiPreference.getState().setHidden(true));
    expect(visible).toBe(false);
  });

  it("remembers the choice for the next visit", () => {
    act(() => useShibiPreference.getState().setHidden(true));
    expect(localStorage.getItem("yieldo.shibi-hidden")).toBe("true");
  });
});
