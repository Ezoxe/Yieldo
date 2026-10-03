import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompactTitle } from "./useCompactTitle";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let report: Callback | null = null;

class FakeObserver {
  constructor(callback: Callback) {
    report = callback;
  }
  observe = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  report = null;
});

function Probe() {
  const title = useCompactTitle("/budgets");
  return <p data-testid="compact">{title ?? "—"}</p>;
}

describe("useCompactTitle", () => {
  it("names the screen once its title has scrolled out above the header", () => {
    render(
      <>
        <main>
          <h1>Budgets</h1>
        </main>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("compact")).toHaveTextContent("—");

    act(() => report?.([{ isIntersecting: false, boundingClientRect: { top: -40 } as DOMRect }]));
    expect(screen.getByTestId("compact")).toHaveTextContent("Budgets");

    act(() => report?.([{ isIntersecting: true, boundingClientRect: { top: 80 } as DOMRect }]));
    expect(screen.getByTestId("compact")).toHaveTextContent("—");
  });

  it("says nothing for a title that is below the fold rather than above it", () => {
    render(
      <>
        <main>
          <h1>Budgets</h1>
        </main>
        <Probe />
      </>,
    );
    act(() => report?.([{ isIntersecting: false, boundingClientRect: { top: 2000 } as DOMRect }]));
    expect(screen.getByTestId("compact")).toHaveTextContent("—");
  });
});
