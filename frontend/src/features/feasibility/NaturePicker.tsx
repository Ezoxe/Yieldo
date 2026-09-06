import { FeasibilityIcon } from "../../design/icons";
import type { FeasibilityContext } from "../../lib/types";
import "./NaturePicker.css";

/**
 * What kind of thing you are buying, asked before anything else.
 *
 * The tool used to open on a form whose first field was a price and whose
 * fourth was a select called "Nature du bien" — which made it, in practice, a
 * property calculator that could also be told about a car. A household saves
 * for a laptop, a kitchen, a wedding and a year of training too, and each of
 * those assumes something different about what it costs to keep and what it is
 * worth afterwards.
 *
 * Every label and every note comes from the server
 * (`engines/ownership.NATURE_PROFILES`), never from a table here: a nature
 * added to the engine has to appear on this screen without anyone remembering
 * to add it, and a nature described in two places drifts.
 */

interface NaturePickerProps {
  context: FeasibilityContext;
  /** The nature already chosen, or null before anything has been. */
  value: string | null;
  onChoose: (nature: string) => void;
}

export function NaturePicker({ context, value, onChoose }: NaturePickerProps) {
  return (
    <div className="yd-nature">
      <p className="yd-nature__lead">
        Ce que vous achetez décide de ce qu'il coûte à garder et de ce qu'il vaudra
        ensuite. Choisissez d'abord ; tout le reste s'ajuste.
      </p>
      <ul className="yd-nature__list">
        {context.natures.map((key) => {
          const profile = context.ownership_defaults[key];
          if (profile === undefined) return null;
          const chosen = value === key;
          return (
            <li key={key}>
              <button
                type="button"
                className="yd-nature__card"
                aria-pressed={chosen}
                onClick={() => onChoose(key)}
              >
                <span className="yd-nature__mark" aria-hidden="true">
                  <FeasibilityIcon />
                </span>
                <span className="yd-nature__label">{profile.label}</span>
                {/* The whole sentence, not a badge. What a nature prefills and
                    what it deliberately leaves empty is the difference between
                    a figure with a source and one without, and the reader has
                    to see it before choosing rather than after. */}
                <span className="yd-nature__note">{profile.note}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
