import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { HallBody } from "./HallBody";
import { HallDefs, hallIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { HallLens } from "./lenses";
import "./HallScene.css";

/**
 * The Loisirs family as an entrance hall, drawn opaque — dusk in the dark
 * theme, day in the light one — with an X-ray lens where the leisure waits
 * by the door: the tickets pinned over the console (outings), the cabin
 * suitcase (holidays), the bike's drivetrain (sport), the guitar (hobbies),
 * and the gauge dial for the family's ceiling.
 *
 * Only the tickets left in the book and the dial's needle carry a figure,
 * and both rest on the true value; the stars, the film, the plane, the
 * chain, the strings and the notes are decoration and stop with the motion
 * preference.
 */
export function HallScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = hallIds(`yd-hall${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-hall">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <HallDefs ids={ids} />
          <HallBody ids={ids} />
          {parts.map((reading) => (
            <HallLens
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
        {`Une entrée de maison dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
