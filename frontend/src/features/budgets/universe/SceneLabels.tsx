import type { CSSProperties } from "react";

import type { BudgetStatus } from "../../../lib/types";
import "./SceneLabels.css";

export type LabelTone = "neutral" | BudgetStatus;

export interface SceneLabel {
  key: string;
  title: string;
  amount: string;
  detail?: string;
  tone: LabelTone;
  /** Where the label meets its leader, in the scene's viewBox units. */
  anchor: { x: number; y: number; align: "above" | "left" | "below" | "below-start" };
  /** Absent: the label is a reading, not a way somewhere. */
  onSelect?: () => void;
  /** The page's own category: marked, and not a link to itself. */
  current?: boolean;
  dimmed?: boolean;
}

interface SceneLabelsProps {
  view: { width: number; height: number };
  labels: SceneLabel[];
}

/**
 * The words of a scene, as HTML rather than as SVG text.
 *
 * A drawing scales with its box and its text with it: at 390 px the car's
 * viewBox is drawn at half size and a 12px label would print at 6px. So the
 * labels are HTML in the theme's own colours — pinned on the drawing at the
 * end of their leader when the scene is wide enough to carry them, a plain
 * list under it otherwise (`SceneLabels.css`, container query on the scene).
 * One list either way: nothing is rendered twice to be hidden once.
 *
 * Each label is the accessible control for its part; the lenses in the SVG
 * are pointer shortcuts to the same place and are hidden from assistive tech.
 */
export function SceneLabels({ view, labels }: SceneLabelsProps) {
  return (
    <ul className="yd-scene-labels">
      {labels.map((label) => {
        const style = {
          "--x": `${(label.anchor.x / view.width) * 100}%`,
          "--y": `${(label.anchor.y / view.height) * 100}%`,
        } as CSSProperties;
        const classes = [
          "yd-scene-label",
          `yd-scene-label--${label.anchor.align}`,
          `yd-scene-label--${label.tone}`,
          label.dimmed ? "yd-scene-label--dimmed" : "",
          label.current ? "yd-scene-label--current" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const body = (
          <>
            <span className="yd-scene-label__title">
              <span className="yd-scene-label__dot" aria-hidden="true" />
              {label.title}
            </span>
            <span className="yd-scene-label__figures">
              <span className="yd-scene-label__amount yd-num">{label.amount}</span>
              {label.detail ? <span className="yd-scene-label__detail yd-num">{label.detail}</span> : null}
            </span>
          </>
        );
        return (
          <li key={label.key} className={classes} style={style}>
            {label.onSelect ? (
              <button type="button" className="yd-scene-label__box" onClick={label.onSelect}>
                {body}
              </button>
            ) : (
              <span className="yd-scene-label__box" aria-current={label.current ? "page" : undefined}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
