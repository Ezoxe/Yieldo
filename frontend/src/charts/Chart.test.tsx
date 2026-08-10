import { fireEvent, render, screen } from "@testing-library/react";
import * as echarts from "echarts";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import { Chart, rowsToCsv } from "./Chart";

function stubMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduced-motion") ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderChart(props: Partial<ComponentProps<typeof Chart>> = {}) {
  return render(
    <ThemeProvider>
      <Chart
        option={{
          xAxis: { type: "category", data: ["a", "b", "c"] },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: [1, 2, 3] }],
        }}
        ariaLabel="Graphique de test"
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("rowsToCsv", () => {
  it("builds a semicolon-separated CSV with a UTF-8 BOM for Excel", () => {
    const csv = rowsToCsv(["Catégorie", "Montant"], [{ Catégorie: "Alimentation", Montant: "47,32 €" }]);
    expect(csv).toBe("﻿Catégorie;Montant\nAlimentation;47,32 €");
  });

  it("quotes cells containing the delimiter, a quote, or a newline", () => {
    const csv = rowsToCsv(["Libellé"], [{ Libellé: "Loyer; charges" }]);
    expect(csv).toContain('"Loyer; charges"');
  });

  it("never lets an untrusted label break the row structure", () => {
    const csv = rowsToCsv(["Libellé"], [{ Libellé: 'a";DROP TABLE' }]);
    expect(csv.split("\n")).toHaveLength(2);
  });
});

describe("Chart", () => {
  beforeEach(() => stubMatchMedia(false));

  it("renders an accessible role=img with the given label", () => {
    renderChart({ ariaLabel: "Flux de trésorerie" });
    expect(screen.getByRole("img", { name: "Flux de trésorerie" })).toBeInTheDocument();
  });

  it("initializes exactly one echarts instance on the container", () => {
    const { getByRole } = renderChart();
    const node = getByRole("img");
    expect(echarts.getInstanceByDom(node)).toBeDefined();
  });

  it("disposes the echarts instance on unmount instead of leaking it", () => {
    const { unmount, getByRole } = renderChart();
    const node = getByRole("img");
    unmount();
    expect(echarts.getInstanceByDom(node)).toBeUndefined();
  });

  it("disables echarts animation when the user prefers reduced motion", () => {
    stubMatchMedia(true);
    const { getByRole } = renderChart();
    const node = getByRole("img");
    const instance = echarts.getInstanceByDom(node);
    expect(instance?.getOption().animation).toBe(false);
  });

  it("keeps animation on by default", () => {
    const { getByRole } = renderChart();
    const node = getByRole("img");
    const instance = echarts.getInstanceByDom(node);
    expect(instance?.getOption().animation).toBe(true);
  });

  it("shows only a PNG export option when no export rows are supplied", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    expect(screen.getByRole("menuitem", { name: "Image (PNG)" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Données (CSV)" })).not.toBeInTheDocument();
  });

  it("offers a CSV export once data rows are supplied, and triggers a download", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderChart({
      dataForExport: { filename: "flux", headers: ["Mois"], rows: [{ Mois: "Janvier" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Données (CSV)" }));

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
