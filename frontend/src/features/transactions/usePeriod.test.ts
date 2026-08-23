import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { periodBounds, usePeriod } from "./usePeriod";

const today = new Date("2026-08-09T12:00:00Z");

describe("periodBounds", () => {
  it("bounds the current month", () => {
    expect(periodBounds("month", today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("bounds the current quarter", () => {
    expect(periodBounds("quarter", today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("bounds the current year", () => {
    expect(periodBounds("year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("bounds year to date", () => {
    expect(periodBounds("ytd", today)).toEqual({ from: "2026-01-01", to: "2026-08-09" });
  });

  it("returns an open range for all time", () => {
    expect(periodBounds("all", today)).toEqual({ from: "", to: "" });
  });

  it("handles a leap-year February", () => {
    expect(periodBounds("month", new Date("2028-02-15T00:00:00Z")))
      .toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("handles December without rolling the year", () => {
    expect(periodBounds("month", new Date("2026-12-20T00:00:00Z")))
      .toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

function wrapperAt(path: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [path] }, children);
}

describe("usePeriod", () => {
  it("falls back to the current month when no preset is in the URL", () => {
    const { result } = renderHook(() => usePeriod(), { wrapper: wrapperAt("/transactions") });
    expect(result.current.preset).toBe("month");
  });

  // The analysis screen opens on "Tout" instead: its two engines each resolve
  // their own honest window from the ledger when no bound is sent, and the
  // current calendar month on a ledger that stopped months ago is an empty
  // window whose refusal names the wrong cause.
  it("honours a caller's own default preset when the URL names none", () => {
    const { result } = renderHook(() => usePeriod("all"), { wrapper: wrapperAt("/analyse") });
    expect(result.current.preset).toBe("all");
    expect(result.current.from).toBe("");
    expect(result.current.to).toBe("");
  });

  it("lets the URL override the caller's default", () => {
    const { result } = renderHook(() => usePeriod("all"), {
      wrapper: wrapperAt("/analyse?periode=year"),
    });
    expect(result.current.preset).toBe("year");
  });
});
