import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { DressingBody } from "./DressingBody";
import { DressingDefs, dressingIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { DressingLens } from "./lenses";
import "./DressingScene.css";

/**
 * The Achats family as a dressing room, drawn opaque — dusk in the dark
 * theme, day in the light one — with an X-ray lens where each purchase is
 * kept: the clothes rail (clothing), the laptop on the chest of drawers
 * (equipment and high-tech), the arc lamp (home and decoration), the pile of
 * presents (gifts), and the gauge dial for the family's ceiling.
 *
 * Only the dressed hangers and the dial's needle carry a figure, and both
 * rest on the true value; the filament, the light, the sparkles and the
 * signals on the board are decoration and stop with the motion preference.
 */
export function DressingScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = dressingIds(`yd-dressing${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-dressing">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <DressingDefs ids={ids} />
          <DressingBody ids={ids} />
          {parts.map((reading) => (
            <DressingLens
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
        {`Un dressing dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
