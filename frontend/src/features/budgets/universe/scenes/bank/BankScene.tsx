import { useId } from "react";

import { SceneLabels } from "../../SceneLabels";
import { Dial } from "../shared/Dial";
import { Leaders, sceneLabels } from "../shared/labels";
import type { SceneProps } from "../UniverseScene";
import { BankBody } from "./BankBody";
import { BankDefs, bankIds } from "./defs";
import { LENSES, VIEW } from "./geometry";
import { BankLens } from "./lenses";
import "./BankScene.css";

/**
 * The Frais bancaires family as a bank's lobby, drawn opaque — after hours
 * in the dark theme, by day in the light one — with an X-ray lens where each
 * fee is charged: the cash machine (the card), the statement on the
 * counter's tray (account keeping), the vault (overdraft interest and
 * incidents), and the gauge dial for the family's ceiling.
 *
 * Only the notes left in the cassette and the dial's needle carry a figure,
 * and both rest on the true value; the rollers, the stamp, the vault's dial
 * and the clock are decoration and stop with the motion preference.
 */
export function BankScene({ gauge, gaugeTitle, parts, onSelect }: SceneProps) {
  const ids = bankIds(`yd-bank${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const labels = sceneLabels(gauge, gaugeTitle, parts, LENSES, onSelect);

  return (
    <figure className="yd-scene yd-bank">
      <div className="yd-scene__stage">
        <svg
          className="yd-scene__svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <BankDefs ids={ids} />
          <BankBody ids={ids} />
          {parts.map((reading) => (
            <BankLens
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
        {`Un hall de banque dont chaque objet est un poste : ${parts.map((reading) => reading.name).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
