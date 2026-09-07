import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BentoCell } from "./BentoCell";
import { useCardSpotlight } from "./useCardSpotlight";

function Harness() {
  useCardSpotlight();
  return (
    <>
      <BentoCell data-testid="left">
        <span data-testid="inner">contenu</span>
      </BentoCell>
      <BentoCell data-testid="right" />
      <p data-testid="outside">hors carte</p>
    </>
  );
}

/** The halo of the cell carrying this test id — the element the light is on. */
function halo(container: HTMLElement, testId: string): HTMLElement {
  const found = container
    .querySelector(`[data-testid="${testId}"]`)
    ?.querySelector<HTMLElement>(":scope > .yd-bento__cell-halo");
  if (!found) throw new Error(`no halo in ${testId}`);
  return found;
}

/** jsdom measures every box as zero, so the halos are given one by hand. */
function sizeHalos(container: HTMLElement) {
  for (const node of container.querySelectorAll<HTMLElement>(".yd-bento__cell-halo")) {
    node.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
  }
}

function move(target: Element, x: number, y: number, pointerType = "mouse") {
  const event = new MouseEvent("pointermove", {
    bubbles: true,
    clientX: x,
    clientY: y,
  }) as MouseEvent & { pointerType?: string };
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => {
    target.dispatchEvent(event);
    vi.advanceTimersToNextFrame();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCardSpotlight", () => {
  // Measured against the HALO's box, not the card's: the halo is inset past
  // the card on every side, so a percentage taken from the card would put the
  // light 90px off.
  it("puts the light where the pointer is, in the halo's own coordinates", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeHalos(container);

    move(getByTestId("inner"), 50, 25);

    expect(halo(container, "left").style.getPropertyValue("--yd-cell-x")).toBe("25%");
    expect(halo(container, "left").style.getPropertyValue("--yd-cell-y")).toBe("25%");
  });

  it("lights one card at a time", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeHalos(container);

    move(getByTestId("left"), 20, 20);
    move(getByTestId("right"), 100, 50);

    expect(halo(container, "left").style.getPropertyValue("--yd-cell-x")).toBe("");
    expect(halo(container, "right").style.getPropertyValue("--yd-cell-x")).toBe("50%");
  });

  it("puts the light out when the pointer leaves every card", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeHalos(container);

    move(getByTestId("left"), 20, 20);
    move(getByTestId("outside"), 0, 0);

    expect(halo(container, "left").style.getPropertyValue("--yd-cell-x")).toBe("");
  });

  // A touch screen has no hover: a spotlight left where the finger last
  // pressed is a smudge on the card, not a highlight.
  it("ignores a finger", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeHalos(container);

    move(getByTestId("left"), 20, 20, "touch");

    expect(halo(container, "left").style.getPropertyValue("--yd-cell-x")).toBe("");
  });
});

describe("BentoCell halo", () => {
  it("carries one, hidden from assistive technology", () => {
    const { container } = render(<BentoCell data-testid="cell">chiffres</BentoCell>);
    const nodes = container.querySelectorAll(".yd-bento__cell-halo");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveAttribute("aria-hidden", "true");
    // It is decoration: it must add nothing to what the cell says.
    expect(nodes[0].textContent).toBe("");
  });
});
