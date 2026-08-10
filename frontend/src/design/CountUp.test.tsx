import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountUp } from "./CountUp";

function mockReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("CountUp", () => {
  beforeEach(() => vi.useRealTimers());

  it("shows the final value immediately when motion is reduced", () => {
    mockReducedMotion(true);
    render(<CountUp value={18432000} format={(n) => `${Math.round(n / 100)} €`} />);
    expect(screen.getByText("184320 €")).toBeInTheDocument();
  });

  it("exposes the final value to assistive technology while animating", () => {
    mockReducedMotion(false);
    render(<CountUp value={4180} format={(n) => `${Math.round(n)}`} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "4180");
  });
});
