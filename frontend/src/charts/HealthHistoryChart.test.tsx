import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { HealthSnapshot } from "../lib/types";
import {
  HealthHistoryChart,
  MIN_HISTORY_POINTS,
  buildHealthHistoryOption,
  buildHealthHistoryRows,
  healthHistoryKey,
} from "./HealthHistoryChart";

/**
 * The operator's own history on the day this screen shipped: ONE stored
 * snapshot, because the score is written at most once a day and today is his
 * first read. A single point is not a history and must not be drawn as one.
 */
const ONE_DAY: HealthSnapshot[] = [{ taken_on: "2026-09-01", score: 0 }];

/** A household that has come back. Includes his own score of 0 — a MEASURED
 *  zero, which has to survive the axis rather than disappear into it. */
const SEVERAL_DAYS: HealthSnapshot[] = [
  { taken_on: "2026-09-01", score: 0 },
  { taken_on: "2026-09-02", score: 0 },
  { taken_on: "2026-09-08", score: 12 },
  { taken_on: "2026-09-15", score: 31 },
];

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("buildHealthHistoryOption", () => {
  it("never declares an ECharts legend", () => {
    // A legend wraps onto as many rows as it needs while `grid.top` stays a
    // fixed pixel count, and at 375px the extra rows paint over the plot. Every
    // chart since task 6 of phase 2B puts its key in HTML above the canvas.
    const option = buildHealthHistoryOption(SEVERAL_DAYS, "dark");
    expect(option.legend).toBeUndefined();
  });

  it("pins the axis to the score's own full scale, 0 to 100", () => {
    // Left to itself, ECharts fits the axis to the data: a run of 0, 0, 12, 31
    // would fill the plot and read as a collapse and a surge. The score is
    // defined on 0-100, so the axis is 0-100 and a small move looks small.
    const option = buildHealthHistoryOption(SEVERAL_DAYS, "dark");
    const axis = option.yAxis as { min?: number; max?: number };
    expect(axis.min).toBe(0);
    expect(axis.max).toBe(100);
  });

  it("marks every stored reading rather than implying a continuum", () => {
    // The score is measured once a day, on the days the household opened
    // Yieldo — never continuously. A bare line between two readings a week
    // apart claims values that were never taken; the symbols say where the
    // real measurements are.
    const option = buildHealthHistoryOption(SEVERAL_DAYS, "dark");
    const series = option.series as Array<{ showSymbol?: boolean; data?: number[] }>;
    expect(series[0].showSymbol).toBe(true);
    expect(series[0].data).toEqual([0, 0, 12, 31]);
  });

  it("puts one category tick per stored reading", () => {
    const option = buildHealthHistoryOption(SEVERAL_DAYS, "dark");
    const axis = option.xAxis as { data: string[] };
    expect(axis.data).toHaveLength(SEVERAL_DAYS.length);
  });
});

describe("healthHistoryKey", () => {
  it("names the single band it draws", () => {
    const [entry, ...rest] = healthHistoryKey("dark");
    expect(entry.name).toBe("Score de santé financière");
    expect(rest).toHaveLength(0);
  });
});

describe("buildHealthHistoryRows", () => {
  it("exports the score against the day it was actually stored", () => {
    const rows = buildHealthHistoryRows(SEVERAL_DAYS);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ Date: "1er septembre 2026", Score: 0 });
  });
});

describe("HealthHistoryChart", () => {
  it("draws nothing below two stored readings", () => {
    // The caller writes the sentence: this component's job is to refuse to
    // draw a trend that does not exist yet, not to explain it.
    expect(MIN_HISTORY_POINTS).toBe(2);
    const { container } = render(
      <ThemeProvider>
        <HealthHistoryChart history={ONE_DAY} />
      </ThemeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the key in HTML above the canvas, with the span in the label", () => {
    render(
      <ThemeProvider>
        <HealthHistoryChart history={SEVERAL_DAYS} />
      </ThemeProvider>,
    );
    expect(screen.getByText("Score de santé financière")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/4 relevés du score, du 1er septembre 2026 au 15 septembre 2026/),
    ).toBeInTheDocument();
  });
});
