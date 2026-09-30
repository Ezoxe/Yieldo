import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { SalonDefs, salonIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { SalonBody } from "./SalonBody";
import { SalonLens } from "./lenses";
import "./SalonScene.css";

/**
 * The Abonnements family as a living room, drawn opaque — the evening in the
 * dark theme, the day in the light one — with an X-ray lens on what each
 * subscription is used on: the television (streaming), the laptop (software
 * and services), the magazine (press), the gym bag (gym), and the gauge dial
 * for the family's ceiling.
 *
 * Only the television's progress bar and the dial's needle carry a figure,
 * and both rest on the true value; the rest is decoration and stops with the
 * motion preference.
 */
export function SalonScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = salonIds(`yd-salon${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-salon">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <SalonDefs ids={ids} />
          <SalonBody ids={ids} />
          {parts.map((reading) => (
            <SalonLens
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
        {`Un salon dont chaque objet est un abonnement : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
