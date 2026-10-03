import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMotionPreference } from "./motionPreference";
import { forgetSessionMemory } from "./sessionMemory";
import { ratioTone, useAnimatedRatio } from "./useAnimatedRatio";

const animate = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));
vi.mock("motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion")>()),
  animate,
}));

function Bar({ id, ratio }: { id?: string; ratio: number }) {
  const shown = useAnimatedRatio(id, ratio);
  return <p data-testid="bar">{`${shown.ratio}|${shown.tone}`}</p>;
}

beforeEach(() => {
  animate.mockClear();
  forgetSessionMemory();
  useMotionPreference.setState({ disabled: false });
});

describe("ratioTone", () => {
  it("turns amber at 80 % and rose at 100 %", () => {
    expect(ratioTone(0.5)).toBe("ok");
    expect(ratioTone(0.8)).toBe("at_risk");
    expect(ratioTone(0.99)).toBe("at_risk");
    expect(ratioTone(1)).toBe("over");
    expect(ratioTone(1.07)).toBe("over");
  });
});

describe("useAnimatedRatio", () => {
  // A bar's length is a proportion: the first time it is seen it fills from
  // empty, once; after that it moves from what the reader last saw.
  it("fills from empty the first time, from the remembered level after that", () => {
    render(<Bar id="budget.7" ratio={0.92} />).unmount();
    expect(animate.mock.calls[0][0]).toBe(0);
    expect(animate.mock.calls[0][1]).toBe(0.92);

    render(<Bar id="budget.7" ratio={1.07} />);
    expect(animate.mock.calls[1][0]).toBe(0.92);
    expect(animate.mock.calls[1][1]).toBe(1.07);
  });

  it("does not move a bar that did not change", () => {
    render(<Bar id="budget.8" ratio={0.4} />).unmount();
    animate.mockClear();
    render(<Bar id="budget.8" ratio={0.4} />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId("bar")).toHaveTextContent("0.4|ok");
  });

  it("sits on the true level at once with motion off", () => {
    useMotionPreference.setState({ disabled: true });
    render(<Bar id="budget.9" ratio={1.2} />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId("bar")).toHaveTextContent("1.2|over");
  });
});
