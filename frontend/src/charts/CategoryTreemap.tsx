import type { EChartsOption } from "echarts";

import { formatCents } from "../design/theme";
import type { Category, CategoryBreakdown } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { seriesColors } from "./theme";

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
        color: row.color || fallbackColor(index, resolved),
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

function toEchartsNode(node: CategoryTreemapNode): Record<string, unknown> {
  return {
    name: node.name,
    value: node.valueCents,
    itemStyle: { color: node.color },
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
  if (items.length === 0) {
    return <p className="yd-chart-empty">Aucune dépense enregistrée sur cette période.</p>;
  }

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
        breadcrumb: { show: true },
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
