import { plural } from "../lib/plural";
import "./DataProgress.css";

interface DataProgressProps {
  /** How many of the thing there are today. */
  have: number;
  /** How many the engine needs before it can answer. */
  need: number;
  /** What is being counted, singular. "mois", "opération". */
  unit: string;
  /** The engine's own sentence, printed verbatim underneath. */
  children?: React.ReactNode;
}

/**
 * "Not yet calculable", said as a measurement in progress rather than as a
 * fault.
 *
 * The screens that refuse used to do it with a full-weight banner and a thick
 * left rule in the warning colour — which reads as a crash, not as an engine
 * declining to guess. What is actually true is smaller and more encouraging:
 * a count, a floor, and how far along the household is between them. The
 * engine's own sentence still ships, in full, underneath.
 *
 * The bar is decoration for the figures beside it: the count is stated in
 * words ("3 mois sur 6"), so nothing depends on seeing it.
 */
export function DataProgress({ have, need, unit, children }: DataProgressProps) {
  const capped = Math.min(have, need);
  const percent = need <= 0 ? 100 : Math.round((capped / need) * 100);

  return (
    <div className="yd-progress">
      <p className="yd-progress__head">
        <span className="yd-progress__chip">
          {`${capped} ${plural(capped, unit, `${unit}s`)} sur ${need}`}
        </span>
        <span className="yd-progress__label">Mesure en cours</span>
      </p>

      <div
        className="yd-progress__track"
        role="progressbar"
        aria-label={`Données réunies : ${capped} ${unit} sur ${need}`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="yd-progress__fill" style={{ width: `${percent}%` }} />
      </div>

      {children ? <p className="yd-progress__reason">{children}</p> : null}
    </div>
  );
}
