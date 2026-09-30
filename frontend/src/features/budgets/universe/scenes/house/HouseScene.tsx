import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { HouseDefs, houseIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { HouseBackdrop, HouseBody } from "./HouseBody";
import { HouseLens } from "./lenses";
import "./HouseScene.css";

/**
 * The Logement family as a traditional pavillon: drawn opaque, at dusk in the
 * dark theme and by day in the light one, with a round X-ray window on each
 * part that carries a figure — the roof frame, the lock of the front door,
 * the box behind the window, the electricity meter in the low wall, the water
 * meter in the lawn, the garage workbench — and the gauge dial for the
 * family's ceiling.
 *
 * Only the meter's lit bars and the dial's needle carry a figure, and both
 * rest on the true value; the smoke, the stars, the key, the lights, the
 * water and the drill are decoration and stop with the motion preference.
 */
export function HouseScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = houseIds(`yd-house${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-house">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <HouseDefs ids={ids} />
          <HouseBackdrop ids={ids} />
          <HouseBody ids={ids} />
          {parts.map((reading) => (
            <HouseLens
              key={reading.part}
              reading={reading}
              ids={ids}
              onSelect={reading.focused ? undefined : () => onSelect(reading.categoryId)}
            />
          ))}
          <Leaders parts={parts} anchors={LENSES} />
          {gauge !== null ? <Dial gauge={gauge} /> : null}
        </svg>
        <SceneLabels view={VIEW} labels={labels} />
      </div>
      <figcaption className="sr-only">
        {`Une maison dont chaque pièce est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
