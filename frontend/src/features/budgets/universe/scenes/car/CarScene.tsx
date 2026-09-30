import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import { CarBackdrop, CarBody } from "./CarBody";
import { SceneDefs, sceneIds } from "./defs";
import { FRONT_WHEEL, LENSES, REAR_WHEEL, VIEW } from "./geometry";
import { Lens } from "./lenses";
import type { SceneProps } from "../UniverseScene";
import { Wheel } from "./Wheel";
import "./CarScene.css";


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
export function CarScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = sceneIds(`yd-car${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);

  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-car">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
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
          <Leaders parts={parts} anchors={LENSES} />
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
