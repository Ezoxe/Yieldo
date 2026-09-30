import { useId } from "react";

import { formatCents } from "../../../../../design/theme";
import { plural } from "../../../../../lib/plural";
import type { Gauge, PartReading } from "../../readings";
import { SceneLabels, type SceneLabel } from "../../SceneLabels";
import { CarBackdrop, CarBody } from "./CarBody";
import { SceneDefs, sceneIds } from "./defs";
import { Dial } from "./Dial";
import { DIAL, FRONT_WHEEL, LENSES, REAR_WHEEL, VIEW } from "./geometry";
import { Lens } from "./lenses";
import { Wheel } from "./Wheel";
import "./CarScene.css";

interface CarSceneProps {
  /** The page's own ceiling; null draws no dial. */
  gauge: Gauge | null;
  /** What the dial measures, said in words: « Budget Transport ». */
  gaugeTitle: string;
  parts: PartReading[];
  /** Opens the page of a part's category. */
  onSelect: (categoryId: number) => void;
}

/** The figure beside a part's amount: what is left of its ceiling, its mean, or its count. */
function detailFor(reading: PartReading): string {
  const { level, budget } = reading;
  if (level?.basis === "budget" && budget !== null) {
    return budget.remaining_cents >= 0
      ? `reste ${formatCents(budget.remaining_cents)}`
      : `dépassé de ${formatCents(-budget.remaining_cents)}`;
  }
  if (level?.basis === "average") return `moyenne ${formatCents(level.referenceCents)}`;
  return `${reading.count} ${plural(reading.count, "opération", "opérations")}`;
}

/**
 * The Transport family as a car: a white GT drawn opaque, with a round X-ray
 * window on each part that carries a figure — the tank behind the front
 * axle, the flat-six behind the rear one, the roll cage through the rear
 * window, the toll badge behind the mirror — and a fuel-gauge dial for the
 * family's ceiling.
 *
 * Only the tank's level and the dial's needle carry a figure, and both rest on
 * the true value; wheels, road, pistons, the passing gantry and the sweeps are
 * decoration and stop with the motion preference (`CarScene.css`).
 */
export function CarScene({ gauge, gaugeTitle, parts, onSelect }: CarSceneProps) {
  const ids = sceneIds(`yd-car${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);

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
      anchor: { x: DIAL.label[0], y: DIAL.label[1], align: "below" },
    });
  }
  for (const reading of parts) {
    const lens = LENSES[reading.part];
    labels.push({
      key: reading.part,
      title: reading.name,
      amount: formatCents(Math.abs(reading.spentCents)),
      detail: detailFor(reading),
      tone: reading.status ?? "neutral",
      anchor: { x: lens.leader.to[0], y: lens.leader.to[1], align: lens.align },
      onSelect: reading.focused ? undefined : () => onSelect(reading.categoryId),
      current: reading.focused,
      dimmed: reading.dimmed,
    });
  }

  return (
    <figure className="yd-car">
      <div className="yd-car__stage">
        <svg
          className="yd-car__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <SceneDefs ids={ids} />
          <CarBackdrop ids={ids} />
          <CarBody ids={ids} />
          <Wheel geometry={REAR_WHEEL} ids={ids} />
          <Wheel geometry={FRONT_WHEEL} ids={ids} />
          {parts.map((reading) => (
            <Lens
              key={reading.part}
              reading={reading}
              ids={ids}
              onSelect={reading.focused ? undefined : () => onSelect(reading.categoryId)}
            />
          ))}
          <g className="yd-car__leaders">
            {parts.map((reading) => {
              const { from, to } = LENSES[reading.part].leader;
              return (
                <path
                  key={reading.part}
                  d={`M${from[0]},${from[1]} L${to[0]},${to[1]}`}
                  className={`yd-car__leader yd-car__leader--${reading.status ?? "neutral"}${reading.dimmed ? " yd-car__leader--dimmed" : ""}`}
                />
              );
            })}
          </g>
          {gauge !== null ? <Dial gauge={gauge} /> : null}
        </svg>
        <SceneLabels view={VIEW} labels={labels} />
      </div>
      <figcaption className="sr-only">
        {`Une voiture dont chaque pièce est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
