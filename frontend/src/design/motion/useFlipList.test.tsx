import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMotionPreference } from "./motionPreference";
import { useFlipList } from "./useFlipList";

function List({ keys }: { keys: string[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useFlipList(ref, keys.join(","));
  return (
    <ul ref={ref}>
      {keys.map((key) => (
        <li key={key} data-flip-key={key}>
          {key}
        </li>
      ))}
    </ul>
  );
}

const animate = vi.fn();

beforeEach(() => {
  animate.mockClear();
  Element.prototype.animate = animate as unknown as Element["animate"];
});

afterEach(() => {
  useMotionPreference.setState({ disabled: false });
});

describe("useFlipList", () => {
  // The list's first appearance belongs to the screen's own entry; a row
  // cascade on every visit is a slot machine.
  it("does not animate the rows the list first appears with", () => {
    render(<List keys={["a", "b", "c"]} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("brings the rows that arrive in with a short cascade, capped at eight", () => {
    const { rerender } = render(<List keys={["a"]} />);
    rerender(<List keys={["a", ...Array.from({ length: 12 }, (_, i) => `n${i}`)]} />);
    const delays = animate.mock.calls.map((call) => (call[1] as KeyframeAnimationOptions).delay);
    expect(animate).toHaveBeenCalledTimes(12);
    expect(Math.max(...(delays as number[]))).toBe(8 * 25);
  });

  it("keeps still with motion off", () => {
    useMotionPreference.setState({ disabled: true });
    const { rerender } = render(<List keys={["a"]} />);
    rerender(<List keys={["a", "b"]} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
