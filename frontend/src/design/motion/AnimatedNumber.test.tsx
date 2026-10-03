import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnimatedNumber } from "./AnimatedNumber";
import { useMotionPreference } from "./motionPreference";
import { figureMemory, forgetSessionMemory } from "./sessionMemory";

const animate = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));
vi.mock("motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion")>()),
  animate,
}));

const euros = (cents: number) => `${Math.round(cents / 100)} €`;

beforeEach(() => {
  animate.mockClear();
  forgetSessionMemory();
  useMotionPreference.setState({ disabled: false });
});

afterEach(() => {
  useMotionPreference.setState({ disabled: false });
});

describe("AnimatedNumber", () => {
  // Counting up from zero on every visit said nothing: the first time a
  // figure is seen, it is simply shown.
  it("shows a figure seen for the first time as it is, without rolling", () => {
    render(<AnimatedNumber value={184_237} format={euros} memoryKey="overview.net" />);
    expect(screen.getByText("1842 €")).toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
    expect(figureMemory.recall("overview.net")).toBe(184_237);
  });

  it("rolls from the old value to the new one when the figure changes", () => {
    const { rerender } = render(<AnimatedNumber value={100_00} format={euros} />);
    rerender(<AnimatedNumber value={150_00} format={euros} />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toBe(100_00);
    expect(animate.mock.calls[0][1]).toBe(150_00);
  });

  it("rolls from what the reader last saw when the screen is visited again", () => {
    const onChange = vi.fn();
    const first = render(<AnimatedNumber value={163_012} format={euros} memoryKey="k" />);
    first.unmount();

    render(<AnimatedNumber value={184_237} format={euros} memoryKey="k" onChange={onChange} />);
    expect(animate.mock.calls[0][0]).toBe(163_012);
    expect(animate.mock.calls[0][1]).toBe(184_237);
    expect(onChange).toHaveBeenCalledWith(163_012, 184_237);
  });

  it("does not move at all when nothing changed since the last visit", () => {
    const onChange = vi.fn();
    render(<AnimatedNumber value={500} format={euros} memoryKey="same" />).unmount();
    render(<AnimatedNumber value={500} format={euros} memoryKey="same" onChange={onChange} />);
    expect(animate).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the value at once with motion off, and still remembers it", () => {
    useMotionPreference.setState({ disabled: true });
    render(<AnimatedNumber value={20_000} format={euros} memoryKey="off" />).unmount();
    expect(animate).not.toHaveBeenCalled();

    useMotionPreference.setState({ disabled: false });
    render(<AnimatedNumber value={25_000} format={euros} memoryKey="off" />);
    expect(animate.mock.calls[0][0]).toBe(20_000);
  });

  it("gives assistive technology the true value, never a passing digit", () => {
    render(<AnimatedNumber value={4180} format={(n) => `${Math.round(n)}`} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "4180");
  });

  it("forgets everything with the session", () => {
    render(<AnimatedNumber value={1} format={euros} memoryKey="gone" />).unmount();
    forgetSessionMemory();
    expect(figureMemory.recall("gone")).toBeUndefined();
  });
});
