import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "../app/ThemeProvider";
import { DownloadIcon } from "../design/icons";
import { useReducedMotion } from "../design/motion/useReducedMotion";
import "./Chart.css";
import { buildEchartsTheme, chartTokens } from "./theme";

const THEME_NAME = "yieldo";

export interface ChartExportRow {
  [column: string]: string | number;
}

export interface ChartExportData {
  filename: string;
  headers: string[];
  rows: ChartExportRow[];
}

interface ChartProps {
  option: echarts.EChartsOption;
  height?: number;
  ariaLabel: string;
  onEvents?: Record<string, (params: unknown) => void>;
  /** When provided, the export menu also offers the underlying rows as CSV. */
  dataForExport?: ChartExportData;
}

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  // Semicolon-delimited on purpose (see rowsToCsv below), so only a quote,
  // the delimiter itself, or a newline force quoting -- a plain comma is a
  // normal character here (it is the French decimal separator, e.g. in
  // "47,32 €") and must not trigger it.
  return /["\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Semicolon-delimited (Excel's default in a French locale) with a UTF-8 BOM
// so accented characters survive a straight double-click open in Excel.
export function rowsToCsv(headers: string[], rows: ChartExportRow[]): string {
  const lines = [headers.map(escapeCsvCell).join(";")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header] ?? "")).join(";"));
  }
  return `﻿${lines.join("\n")}`;
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

// Owns the entire ECharts lifecycle: one instance per mount, resized via
// ResizeObserver, updated in place via setOption (never re-instantiated for
// a data change), and disposed on unmount. A theme switch is the one
// exception -- ECharts bakes its theme in at `init()`, so the effect below
// re-inits whenever `resolved` changes rather than trying to hot-swap it.
export function Chart({ option, height = 320, ariaLabel, onEvents, dataForExport }: ChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const { resolved } = useTheme();
  const reducedMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    echarts.registerTheme(THEME_NAME, buildEchartsTheme(resolved));
    instance.current = echarts.init(container.current, THEME_NAME, { renderer: "canvas" });

    // jsdom (and some very old browsers) have no ResizeObserver -- degrade
    // to "the chart only resizes on next data/theme update" rather than
    // crash the mount.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => instance.current?.resize());
      observer.observe(container.current);
    }

    return () => {
      observer?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, [resolved]);

  useEffect(() => {
    instance.current?.setOption(
      {
        ...option,
        animation: !reducedMotion,
        animationDuration: 700,
        animationEasing: "cubicOut",
      },
      { notMerge: false, lazyUpdate: true },
    );
  }, [option, reducedMotion]);

  useEffect(() => {
    if (!instance.current || !onEvents) return;
    for (const [event, handler] of Object.entries(onEvents)) instance.current.on(event, handler);
    return () => {
      for (const event of Object.keys(onEvents)) instance.current?.off(event);
    };
  }, [onEvents]);

  function exportPng() {
    const url = instance.current?.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: chartTokens(resolved).surfaceStrong,
    });
    if (url) downloadDataUrl(`${dataForExport?.filename ?? "graphique"}.png`, url);
    setMenuOpen(false);
  }

  function exportCsv() {
    if (!dataForExport) return;
    downloadBlob(`${dataForExport.filename}.csv`, rowsToCsv(dataForExport.headers, dataForExport.rows), "text/csv;charset=utf-8");
    setMenuOpen(false);
  }

  return (
    <div className="yd-chart">
      <div className="yd-chart__toolbar">
        <button
          type="button"
          className="yd-chart__export-toggle"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <DownloadIcon />
          Exporter
        </button>
        {menuOpen ? (
          <div role="menu" className="yd-chart__export-menu">
            <button type="button" role="menuitem" onClick={exportPng}>
              Image (PNG)
            </button>
            {dataForExport ? (
              <button type="button" role="menuitem" onClick={exportCsv}>
                Données (CSV)
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div ref={container} role="img" aria-label={ariaLabel} style={{ width: "100%", height }} />
    </div>
  );
}
