import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { NurseryBody } from "./NurseryBody";
import { NurseryDefs, nurseryIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { NurseryLens } from "./lenses";
import "./NurseryScene.css";

/**
 * The Famille family as a child's bedroom, drawn opaque — night in the dark
 * theme, day in the light one — with an X-ray lens where the family spends:
 * the baby bottle on the changing table (childcare), the satchel at the foot
 * of the desk (schooling), the dog's basket (pets), and the gauge dial for
 * the family's ceiling.
 *
 * Only the milk left in the bottle and the dial's needle carry a figure, and
 * both rest on the true value; the ripples, the bubbles, the mobile, the
 * thrown stars, the good-work star and the dog's breathing are decoration
 * and stop with the motion preference.
 */
export function NurseryScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = nurseryIds(`yd-nursery${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-nursery">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <NurseryDefs ids={ids} />
          <NurseryBody ids={ids} />
          {parts.map((reading) => (
            <NurseryLens
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
        {`Une chambre d'enfant dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
