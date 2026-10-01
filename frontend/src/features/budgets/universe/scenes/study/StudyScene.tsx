import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { StudyBody } from "./StudyBody";
import { StudyDefs, studyIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { StudyLens } from "./lenses";
import "./StudyScene.css";

/**
 * The Impôts family as a study, drawn opaque — dusk in the dark theme, day
 * in the light one — with an X-ray lens where each tax leaves its paper
 * trail: the hourglass on the bureau (income tax), the framed cadastral plan
 * (property tax), the letter tray (housing tax), the adding machine (other
 * levies), and the gauge dial for the family's ceiling.
 *
 * Only the sand left in the hourglass and the dial's needle carry a figure,
 * and both rest on the true value; the falling sand, the parcel's outline,
 * the incoming letter and the printing tape are decoration and stop with
 * the motion preference.
 */
export function StudyScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = studyIds(`yd-study${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-study">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <StudyDefs ids={ids} />
          <StudyBody ids={ids} />
          {parts.map((reading) => (
            <StudyLens
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
        {`Un bureau dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
