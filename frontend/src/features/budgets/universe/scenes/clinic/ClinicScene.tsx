import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { ClinicBody } from "./ClinicBody";
import { ClinicDefs, clinicIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { ClinicLens } from "./lenses";
import "./ClinicScene.css";

/**
 * The Santé family as a doctor's office, drawn opaque — dusk in the dark
 * theme, day in the light one — with an X-ray lens where the care is paid
 * for: the medicine cabinet (pharmacy), the stethoscope on the desk
 * (consultations), the card reader (the mutuelle), the glasses and the tooth
 * on their shelf (optics and dental care), and the gauge dial for the
 * family's ceiling.
 *
 * Only the blister's pills and the dial's needle carry a figure, and both
 * rest on the true value; the heartbeat, the reader's screen, the glint and
 * the pharmacy's cross across the street are decoration and stop with the
 * motion preference.
 */
export function ClinicScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = clinicIds(`yd-clinic${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-clinic">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <ClinicDefs ids={ids} />
          <ClinicBody ids={ids} />
          {parts.map((reading) => (
            <ClinicLens
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
        {`Un cabinet médical dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
