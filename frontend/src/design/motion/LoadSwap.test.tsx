import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadSwap } from "./LoadSwap";
import { useMotionPreference } from "./motionPreference";

const skeleton = <p>Squelette</p>;
const content = <p>Contenu</p>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  useMotionPreference.setState({ disabled: false });
});

describe("LoadSwap", () => {
  // A local server answers in 40ms: a skeleton drawn for that long is a flash
  // between the screen and itself.
  it("never draws a skeleton for an answer that comes within 150ms", () => {
    const { rerender } = render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.queryByText("Squelette")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    rerender(<LoadSwap loading={false} skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.queryByText("Squelette")).not.toBeInTheDocument();
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });

  it("draws the skeleton after 150ms, then hands over to the content", () => {
    const { rerender } = render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    act(() => vi.advanceTimersByTime(160));
    expect(screen.getByText("Squelette")).toBeInTheDocument();
    expect(screen.queryByText("Contenu")).not.toBeInTheDocument();

    rerender(<LoadSwap loading={false} skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });

  it("swaps outright with motion off, after the same wait", () => {
    useMotionPreference.setState({ disabled: true });
    const { rerender } = render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    act(() => vi.advanceTimersByTime(160));
    expect(screen.getByText("Squelette")).toBeInTheDocument();
    rerender(<LoadSwap loading={false} skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.queryByText("Squelette")).not.toBeInTheDocument();
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });
});
