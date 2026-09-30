import { formatCents } from "../../../../../design/theme";
import { plural } from "../../../../../lib/plural";
import type { PartId } from "../../registry";
import type { Gauge, PartReading } from "../../readings";
import type { SceneLabel } from "../../SceneLabels";
import { DIAL } from "./Dial";

/** Where a part's label meets its leader, and how it sits against that point. */
export interface LabelAnchor {
  leader: { from: [number, number]; to: [number, number] };
  align: "above" | "left" | "below";
}

/** The figure beside a part's amount: what is left of its ceiling, its mean, or its count. */
export function detailFor(reading: PartReading): string {
  const { level, budget } = reading;
  if (level?.basis === "budget" && budget !== null) {
    return budget.remaining_cents >= 0
      ? `reste ${formatCents(budget.remaining_cents)}`
      : `dépassé de ${formatCents(-budget.remaining_cents)}`;
  }
  if (level?.basis === "average") return `moyenne ${formatCents(level.referenceCents)}`;
  return `${reading.count} ${plural(reading.count, "opération", "opérations")}`;
}

/** The dial's label first, then one label per part, each at the end of its leader. */
export function sceneLabels(
  gauge: Gauge | null,
  gaugeTitle: string,
  parts: PartReading[],
  anchors: Partial<Record<PartId, LabelAnchor>>,
  onSelect: (categoryId: number) => void,
): SceneLabel[] {
  const labels: SceneLabel[] = [];
  if (gauge !== null) {
    labels.push({
      key: "gauge",
      title: gaugeTitle,
      amount:
        gauge.remainingCents >= 0
          ? `Reste ${formatCents(gauge.remainingCents)}`
          : `Dépassé de ${formatCents(-gauge.remainingCents)}`,
      detail: `sur ${formatCents(gauge.budgetCents)}`,
      tone: gauge.status,
      anchor: { x: DIAL.label[0], y: DIAL.label[1], align: "below-start" },
    });
  }
  for (const reading of parts) {
    const anchor = anchors[reading.part];
    if (anchor === undefined) continue;
    labels.push({
      key: reading.part,
      title: reading.name,
      amount: formatCents(Math.abs(reading.spentCents)),
      detail: detailFor(reading),
      tone: reading.status ?? "neutral",
      anchor: { x: anchor.leader.to[0], y: anchor.leader.to[1], align: anchor.align },
      onSelect: reading.focused ? undefined : () => onSelect(reading.categoryId),
      current: reading.focused,
      dimmed: reading.dimmed,
    });
  }
  return labels;
}

/** The dashed lines from each lens to its label. */
export function Leaders({
  parts,
  anchors,
}: {
  parts: PartReading[];
  anchors: Partial<Record<PartId, LabelAnchor>>;
}) {
  return (
    <g className="yd-scene__leaders">
      {parts.map((reading) => {
        const anchor = anchors[reading.part];
        if (anchor === undefined) return null;
        const { from, to } = anchor.leader;
        return (
          <path
            key={reading.part}
            d={`M${from[0]},${from[1]} L${to[0]},${to[1]}`}
            className={`yd-scene__leader yd-scene__leader--${reading.status ?? "neutral"}${reading.dimmed ? " yd-scene__leader--dimmed" : ""}`}
          />
        );
      })}
    </g>
  );
}
