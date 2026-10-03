import { describe, expect, it } from "vitest";

import { revealOrigin } from "./revealOrigin";

function control(): Element {
  const element = document.createElement("button");
  element.getBoundingClientRect = () =>
    ({ left: 100, top: 40, width: 60, height: 20 }) as DOMRect;
  return element;
}

describe("revealOrigin", () => {
  it("opens from the pointer when a pointer clicked", () => {
    expect(revealOrigin({ currentTarget: control(), clientX: 12, clientY: 34, detail: 1 })).toEqual(
      { x: 12, y: 34 },
    );
  });

  it("opens from the control's centre when the keyboard asked", () => {
    expect(revealOrigin({ currentTarget: control(), clientX: 0, clientY: 0, detail: 0 })).toEqual({
      x: 130,
      y: 50,
    });
    expect(revealOrigin({ currentTarget: control() })).toEqual({ x: 130, y: 50 });
  });
});
