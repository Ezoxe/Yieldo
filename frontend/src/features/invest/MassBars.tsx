import { CheckIcon } from "../../design/icons";
import { formatProbability } from "./format";
import "./invest.css";

interface MassBarsProps {
  /** Label → basis points, in the order to draw them. The whole is 10 000. */
  mass: Record<string, number>;
  /** The key the model actually answered with, marked by a tick. */
  chosen: string | null;
  /** Optional display names for the keys (« Se poursuit » for `true`). */
  labels?: Record<string, string>;
}

/**
 * The model's whole distribution, one bar per option or per level.
 *
 * A choice with 36 % on the winner and 35 % on the runner-up is a coin toss
 * that happens to have landed; the answer alone (« ne rien faire ») hides
 * that, the mass shows it. Same scale for every bar (100 % is the full
 * track), so eleven levels at 9 % each read as the flat line they are.
 *
 * The chosen key carries `aria-current` and a tick: the state is never the
 * tint alone.
 */
export function MassBars({ mass, chosen, labels }: MassBarsProps) {
  return (
    <ul className="yd-mass" aria-label="Répartition de la masse de probabilité">
      {Object.entries(mass).map(([key, bps]) => {
        const active = key === chosen;
        return (
          <li
            key={key}
            className={`yd-mass__row${active ? " yd-mass__row--chosen" : ""}`}
            aria-current={active ? "true" : undefined}
          >
            <span className="yd-mass__label">{labels?.[key] ?? key}</span>
            <span className="yd-mass__track" aria-hidden="true">
              <span className="yd-mass__fill" style={{ inlineSize: `${bps / 100}%` }} />
            </span>
            <span className="yd-mass__value yd-num">{formatProbability(bps)}</span>
            <span className="yd-mass__tick" aria-label={active ? "réponse retenue" : undefined}>
              {active ? <CheckIcon /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
