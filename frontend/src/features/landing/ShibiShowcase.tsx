import { useEffect, useState } from "react";

import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { Shibi } from "../../design/shibi/Shibi";
import { SHIBI_ANIMATIONS } from "../../design/shibi/sprite";
import "./ShibiShowcase.css";

/**
 * The shibi, on the page that has to explain him.
 *
 * Two halves, because he does two things. On the left he cycles through his
 * own six states with the sentence that says which real situation each one
 * stands for. On the right he does the thing those states are for: he walks a
 * reasoning trace, standing beside each tool the assistant used.
 *
 * The trace below is FABRICATED and says so, exactly like the dashboard
 * preview further up the page. The tool names are the real ones the engines
 * emit; the counts beside them are invented, and no visitor may be able to
 * mistake them for a reading of their own ledger.
 */

/** How long he holds one state before moving to the next. */
const STATE_DWELL = 2600;
/** How long he stands beside one step of the trace. */
const STEP_DWELL = 780;
/** The pause at the end of the walk, before he starts it again. */
const WALK_PAUSE = 1400;

interface DemoStep {
  tool: string;
  label: string;
  source: string;
}

const DEMO_STEPS: DemoStep[] = [
  {
    tool: "engines/intent",
    label: "Lecture de la question",
    source: "intention reconnue : total_by_category",
  },
  {
    tool: "relevé",
    label: "Lecture du relevé",
    source: "198 opérations, 11 catégories, du 1er au 31 août",
  },
  {
    tool: "engines/period",
    label: "Résolution de la période",
    source: "août 2026",
  },
  {
    tool: "engines/aggregate",
    label: "Somme par catégorie",
    source: "catégorie « Restaurants »",
  },
];

export function ShibiShowcase() {
  const reduced = useReducedMotion();
  const [stateIndex, setStateIndex] = useState(0);
  // -1 is "he has finished the walk and is out of the way", which is exactly
  // what happens on a real trace once the last tool has been pointed at.
  const [perch, setPerch] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(
      () => setStateIndex((i) => (i + 1) % SHIBI_ANIMATIONS.length),
      STATE_DWELL,
    );
    return () => window.clearInterval(id);
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    let step = 0;
    let timer = 0;
    const advance = () => {
      step += 1;
      if (step > DEMO_STEPS.length) {
        step = 0;
        setPerch(0);
        timer = window.setTimeout(advance, STEP_DWELL);
        return;
      }
      // One beat past the last step he leaves, then the walk begins again.
      setPerch(step === DEMO_STEPS.length ? -1 : step);
      timer = window.setTimeout(advance, step === DEMO_STEPS.length ? WALK_PAUSE : STEP_DWELL);
    };
    timer = window.setTimeout(advance, STEP_DWELL);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  const current = SHIBI_ANIMATIONS[stateIndex];

  return (
    <div className="yd-shibi-promo">
      <div className="yd-shibi-promo__portrait">
        <div className="yd-shibi-promo__stage">
          <Shibi
            state={current.key}
            scale={4}
            label={`Le shibi, état ${current.name}`}
          />
        </div>

        <ul className="yd-shibi-promo__states">
          {SHIBI_ANIMATIONS.map((animation, index) => (
            <li
              key={animation.key}
              className="yd-shibi-promo__state"
              data-current={index === stateIndex ? "" : undefined}
            >
              <Shibi state={animation.key} scale={1} />
              <span>{animation.name}</span>
            </li>
          ))}
        </ul>

        <p className="yd-shibi-promo__note">{current.note}</p>
      </div>

      <figure className="yd-shibi-promo__trace">
        <p className="yd-shibi-promo__question">
          « Combien j'ai dépensé en restaurants en août&nbsp;? »
        </p>
        <p className="yd-shibi-promo__answer">
          <span className="yd-num">128,40&nbsp;€</span> sur onze opérations, dans la
          catégorie Restaurants.
        </p>

        <ol className="yd-shibi-promo__steps">
          {DEMO_STEPS.map((step, index) => (
            <li
              key={step.tool}
              className="yd-shibi-promo__step"
              data-perched={perch === index ? "" : undefined}
            >
              {perch === index ? (
                <span className="yd-shibi-promo__perch" aria-hidden="true">
                  <Shibi state="designation" />
                </span>
              ) : null}
              <span className="yd-shibi-promo__dot" aria-hidden="true" />
              <span className="yd-shibi-promo__body">
                <span className="yd-shibi-promo__label">
                  {step.label}
                  <code>{step.tool}</code>
                </span>
                <span className="yd-shibi-promo__source">{step.source}</span>
              </span>
            </li>
          ))}
        </ol>

        <figcaption className="yd-shibi-promo__caption">
          Exemple d'échange — chiffres inventés. Les noms d'outils sont ceux que
          Yieldo affiche réellement&nbsp;; les montants et les décomptes à côté ne
          sont ceux de personne.
        </figcaption>
      </figure>
    </div>
  );
}
