import type { EChartsOption } from "echarts";
import { useTheme } from "../app/ThemeProvider";

import { formatCents } from "../design/theme";
import type { Category, CategoryBreakdown } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { CHART_LABEL_INK, CHART_LABEL_PAPER, chartTokens, neutralFill, seriesColors } from "./theme";

export interface CategoryTreemapNode {
  id: string;
  name: string;
  /** Positive magnitude, in cents -- category_id totals from the backend are
   * always negative (expenses only); this is what sizes the treemap tile. */
  valueCents: number;
  color: string;
  children?: CategoryTreemapNode[];
}

// Every leaf category already carries its own color from the backend (the
// same `category.color` the transactions table's dot bullet already uses),
// so identity here is data-driven, not our own generated ramp -- the
// categorical palette is only a fallback for a category the backend left
// uncolored (e.g. "Non catégorisé").
function fallbackColor(index: number, resolved: "light" | "dark"): string {
  const palette = seriesColors(resolved);
  return palette[index % palette.length];
}

// Groups leaf category totals under their parent so the treemap can drill
// parent -> child (ECharts' treemap does this natively once nodes carry a
// `children` array -- no extra click handling needed). A top-level category
// with no parent, and nothing to group under it, stays a flat leaf rather
// than a pointless single-child wrapper.
export function buildCategoryTreemapItems(
  breakdown: CategoryBreakdown[],
  categories: Category[],
  resolved: "light" | "dark" = "dark",
): CategoryTreemapNode[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  interface Group {
    id: string;
    name: string;
    color: string;
    leaves: { row: CategoryBreakdown; category: Category | undefined }[];
  }

  const groups = new Map<string, Group>();

  breakdown.forEach((row, index) => {
    if (row.category_id === null) {
      groups.set("uncategorized", {
        id: "uncategorized",
        name: row.name,
        // Never the payload's colour and never a slot from the identity ramp:
        // on an untidied ledger this is routinely the biggest tile, and an
        // identity hue makes "unknown" read as the household's largest
        // spending category. See `neutralFill`.
        color: neutralFill(resolved),
        leaves: [{ row, category: undefined }],
      });
      return;
    }

    const category = categoryById.get(row.category_id);
    const topId = category?.parent_id ?? category?.id ?? row.category_id;
    const key = String(topId);
    const existing = groups.get(key);
    if (existing) {
      existing.leaves.push({ row, category });
      return;
    }
    const topCategory = categoryById.get(topId);
    groups.set(key, {
      id: key,
      name: topCategory?.name ?? row.name,
      color: topCategory?.color || row.color || fallbackColor(index, resolved),
      leaves: [{ row, category }],
    });
  });

  return Array.from(groups.values()).map((group) => {
    const magnitude = (cents: number) => Math.abs(cents);
    // A single leaf that IS the top-level category (no parent) renders flat;
    // anything grouped under a synthesized parent, or with more than one
    // leaf, keeps the children so the treemap stays drillable.
    const isFlatLeaf = group.leaves.length === 1 && group.leaves[0].category?.parent_id == null && group.id !== "uncategorized";

    if (isFlatLeaf) {
      const leaf = group.leaves[0];
      return {
        id: group.id,
        name: group.name,
        valueCents: magnitude(leaf.row.total_cents),
        color: group.color,
      };
    }

    const children: CategoryTreemapNode[] = group.leaves.map((leaf, index) => ({
      id: `${group.id}-${leaf.row.category_id ?? index}`,
      name: leaf.row.name,
      valueCents: magnitude(leaf.row.total_cents),
      color: leaf.category?.color || leaf.row.color || group.color,
    }));

    return {
      id: group.id,
      name: group.name,
      valueCents: children.reduce((sum, child) => sum + child.valueCents, 0),
      color: group.color,
      children: group.id === "uncategorized" ? undefined : children,
    };
  });
}

function srgbChannelToLinear(channel255: number): number {
  const channel = channel255 / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const value = hex.trim().replace(/^#/, "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The label colour for one tile: whichever of ink and paper reads better on
 * that tile's own fill.
 *
 * ECharts' treemap default is white on every tile, whatever the tile is. The
 * fills here are the backend's category colours -- pastels chosen to be
 * distinguishable from each other, not to carry white text. Measured on the
 * operator's own dashboard at 1440: white on #4fd6a8 is 1.80:1, on #8ab4f8
 * 2.11:1, on #fb7185 2.69:1. Only the slate "Non catégorisé" tile cleared AA,
 * at 4.63:1. Picking per tile takes every colour in the palette to at least
 * 4.55:1, and the choice is derived from the fill rather than hand-listed, so
 * a category colour the operator has never used cannot slip through.
 */
export function tileLabelColor(fill: string): string {
  return contrastRatio(CHART_LABEL_PAPER, fill) >= contrastRatio(CHART_LABEL_INK, fill)
    ? CHART_LABEL_PAPER
    : CHART_LABEL_INK;
}

function toEchartsNode(node: CategoryTreemapNode): Record<string, unknown> {
  return {
    name: node.name,
    value: node.valueCents,
    itemStyle: { color: node.color },
    label: { color: tileLabelColor(node.color) },
    children: node.children?.map(toEchartsNode),
  };
}

function flattenForExport(nodes: CategoryTreemapNode[], parentName = ""): ChartExportRow[] {
  return nodes.flatMap((node) => {
    const row: ChartExportRow = {
      Catégorie: node.name,
      "Catégorie parente": parentName,
      Montant: formatCents(-node.valueCents),
    };
    const childRows = node.children ? flattenForExport(node.children, node.name) : [];
    return [row, ...childRows];
  });
}

interface CategoryTreemapProps {
  items: CategoryTreemapNode[];
}

export function CategoryTreemap({ items }: CategoryTreemapProps) {
  const { resolved } = useTheme();

  if (items.length === 0) {
    return <p className="yd-chart-empty">Aucune dépense enregistrée sur cette période.</p>;
  }

  const tokens = chartTokens(resolved);
  const total = items.reduce((sum, item) => sum + item.valueCents, 0) || 1;

  const option: EChartsOption = {
    tooltip: {
      formatter: (params) => {
        const point = params as { name?: string; value?: number };
        return `${point.name} : <strong>${formatCents(-(point.value ?? 0))}</strong>`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: "zoomToNode",
        // The tiles stop short of the bottom edge so the breadcrumb has room
        // INSIDE the canvas. Left at its default it renders at the very bottom
        // of the chart box, which put a dark pill half outside the card —
        // visible at 1440 on the dashboard, on both themes.
        top: 0,
        left: 0,
        right: 0,
        bottom: 28,
        breadcrumb: {
          show: true,
          bottom: 0,
          height: 22,
          emptyItemWidth: 20,
          itemStyle: {
            color: tokens.surfaceStrong,
            borderColor: tokens.border,
            borderWidth: 1,
            textStyle: { color: tokens.muted },
          },
        },
        itemStyle: { borderColor: "transparent", gapWidth: 2 },
        // Labels crowd out below ~4% of the total area -- let the legend,
        // tooltip and CSV export carry the rest instead of clipping text.
        // Cast: echarts types this callback's `params.value` as the general
        // OptionDataValue union (it also covers non-numeric axis values);
        // treemap always calls it with a plain number here.
        label: {
          formatter: ((params: { name?: string; value?: number }) =>
            (params.value ?? 0) / total < 0.04 ? "" : (params.name ?? "")) as (params: unknown) => string,
        },
        levels: [
          {},
          { itemStyle: { borderColor: "transparent", gapWidth: 2, borderWidth: 2 } },
        ],
        data: items.map(toEchartsNode),
      },
    ] as EChartsOption["series"],
  };

  return (
    <Chart
      option={option}
      height={360}
      ariaLabel="Répartition des dépenses par catégorie, forable vers les sous-catégories."
      dataForExport={{
        filename: "repartition-depenses",
        headers: ["Catégorie", "Catégorie parente", "Montant"],
        rows: flattenForExport(items),
      }}
    />
  );
}
