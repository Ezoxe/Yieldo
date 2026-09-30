import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { KitchenDefs, kitchenIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { KitchenBody } from "./KitchenBody";
import { KitchenLens } from "./lenses";
import "./KitchenScene.css";

/**
 * The Alimentation family as a kitchen, drawn opaque — the evening in the
 * dark theme, the day in the light one — with an X-ray lens where the food is
 * bought, delivered, brewed or served: the fridge (groceries), the delivery
 * box, the espresso machine (cafés and bars), the plate on the table
 * (restaurants), and the gauge dial for the family's ceiling.
 *
 * Only the fridge's filled places and the dial's needle carry a figure, and
 * both rest on the true value; the steam, the rider and the coffee are
 * decoration and stop with the motion preference.
 */
export function KitchenScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = kitchenIds(`yd-kitchen${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-kitchen">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <KitchenDefs ids={ids} />
          <KitchenBody ids={ids} />
          {parts.map((reading) => (
            <KitchenLens
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
        {`Une cuisine dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
