import { describe, expect, it } from "vitest";

import { periodBounds } from "./usePeriod";

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
