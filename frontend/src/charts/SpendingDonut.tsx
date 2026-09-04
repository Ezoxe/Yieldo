import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, chartTokens, neutralFill, seriesColors } from "./theme";

/** One slice: a category, what it cost, and the colour it is drawn in. */
export interface DonutSlice {
  /** null for the "Non catégorisé" pseudo-category. */
  categoryId: number | null;
  name: string;
  /** A positive magnitude. The caller takes the absolute value; a ring of
   *  negative numbers is not a ring. */
  amountCents: number;
  /** The category's own colour, or null to take a slot from the ramp. */
  color: string | null;
}

interface SpendingDonutProps {
  slices: DonutSlice[];
  /** The figure printed in the hole. Stated by the caller rather than summed
   *  here: what the ring shows and what the total claims must be the same
   *  quantity, and only the caller knows which. */
  totalCents: number;
}

/**
 * Where the month's spending went, as a ring.
 *
 * A ring and not a pie: the hole is where the total goes, and the total is the
 * thing a reader wants first. It reads "of this much, this much went there" in
 * one object instead of two.
 *
 * The slices are NOT re-sorted here. They arrive in the order the list beside
 * the ring shows them, and a ring whose order disagreed with the list beside
 * it would make the same data look like two different answers.
 */
export function buildDonutOption(
  slices: DonutSlice[],
  totalCents: number,
  tokens: ChartTokens,
  palette: string[],
): { option: EChartsOption; exportRows: ChartExportRow[] } {
  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const point = params as { name?: string; value?: number; percent?: number };
        return `${point.name} : <strong>${formatCents(-(point.value ?? 0))}</strong><br/>${(point.percent ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du total`;
      },
    },
    series: [
      {
        type: "pie",
        // The two radii are the whole shape: a 70/90 ring is thin enough to
        // read as a scale and thick enough for a slice to be pointed at.
        radius: ["70%", "90%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        // No labels on the ring itself. Eight labels around a 200px circle is
        // a wreath of text with a chart inside it — the list beside it names
        // every slice, in order, with its figure.
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: tokens.surfaceStrong,
          // The gap between slices, drawn in the card's own colour so the ring
          // reads as segmented rather than as one striped band.
          borderWidth: 3,
          borderRadius: 3,
        },
        emphasis: { scale: true, scaleSize: 4 },
        data: slices.map((slice, index) => ({
          name: slice.name,
          value: Math.abs(slice.amountCents),
          itemStyle: {
            color:
              slice.categoryId === null
                ? neutralFill(tokens.surfaceStrong === "#ffffff" ? "light" : "dark")
                : (slice.color ?? palette[index % palette.length]),
          },
        })),
      },
    ],
  };

  const exportRows: ChartExportRow[] = slices.map((slice) => ({
    Catégorie: slice.name,
    Montant: formatCents(-Math.abs(slice.amountCents)),
    Part: totalCents === 0 ? "—" : `${Math.round((Math.abs(slice.amountCents) / Math.abs(totalCents)) * 100)} %`,
  }));

  return { option, exportRows };
}

export function SpendingDonut({ slices, totalCents }: SpendingDonutProps) {
  const { resolved } = useTheme();

  if (slices.length === 0) {
    return <p className="yd-chart-empty">Aucune dépense enregistrée sur cette période.</p>;
  }

  const { option, exportRows } = buildDonutOption(
    slices,
    totalCents,
    chartTokens(resolved),
    seriesColors(resolved),
  );

  return (
    <div className="yd-donut" data-ai-target="budget-donut">
      <Chart
        option={option}
        height={230}
        ariaLabel={`Répartition des dépenses par catégorie, ${formatCents(totalCents)} au total.`}
        dataForExport={{
          filename: "repartition-budgets",
          headers: ["Catégorie", "Montant", "Part"],
          rows: exportRows,
        }}
      />
      {/* In the hole, and out of the pointer's way: the ring's own tooltip has
          to reach the slice under the cursor. */}
      <div className="yd-donut__centre" aria-hidden="true">
        <span className="yd-donut__total yd-num">{formatCents(totalCents)}</span>
        <span className="yd-donut__caption">Dépenses totales</span>
      </div>
    </div>
  );
}
