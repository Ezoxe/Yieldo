import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCardSpotlight } from "./useCardSpotlight";

function Harness() {
  useCardSpotlight();
  return (
    <>
      <div className="yd-bento__cell" data-testid="left">
        <span data-testid="inner">contenu</span>
      </div>
      <div className="yd-bento__cell" data-testid="right" />
      <p data-testid="outside">hors carte</p>
    </>
  );
}

/** jsdom measures every box as zero, so the cells are given one by hand. */
function sizeCells(container: HTMLElement) {
  for (const cell of container.querySelectorAll<HTMLElement>(".yd-bento__cell")) {
    cell.getBoundingClientRect = () =>
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
  it("puts the light where the pointer is, in the card's own coordinates", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeCells(container);

    move(getByTestId("inner"), 50, 25);

    const left = getByTestId("left");
    expect(left.style.getPropertyValue("--yd-cell-x")).toBe("25%");
    expect(left.style.getPropertyValue("--yd-cell-y")).toBe("25%");
  });

  it("lights one card at a time", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeCells(container);

    move(getByTestId("left"), 20, 20);
    move(getByTestId("right"), 100, 50);

    expect(getByTestId("left").style.getPropertyValue("--yd-cell-x")).toBe("");
    expect(getByTestId("right").style.getPropertyValue("--yd-cell-x")).toBe("50%");
  });

  it("puts the light out when the pointer leaves every card", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeCells(container);

    move(getByTestId("left"), 20, 20);
    move(getByTestId("outside"), 0, 0);

    expect(getByTestId("left").style.getPropertyValue("--yd-cell-x")).toBe("");
  });

  // A touch screen has no hover: a spotlight left where the finger last
  // pressed is a smudge on the card, not a highlight.
  it("ignores a finger", () => {
    const { container, getByTestId } = render(<Harness />);
    sizeCells(container);

    move(getByTestId("left"), 20, 20, "touch");

    expect(getByTestId("left").style.getPropertyValue("--yd-cell-x")).toBe("");
  });
});
