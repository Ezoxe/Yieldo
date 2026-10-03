import "./DeltaPill.css";

const MINUS = "−";

interface DeltaPillProps {
  /** Signed, in the figure's own unit (cents for money). */
  delta: number;
  /** Formats the absolute change; the pill adds the sign. */
  format: (absolute: number) => string;
  /** True where up is good news (a balance, a savings rate), false where it
   *  is bad news (spending). The tone follows the meaning, never the sign. */
  upIsGood: boolean;
  /** What the change is measured against. */
  since?: string;
}

/**
 * The change an AnimatedNumber just rolled through, in words.
 *
 * A figure that moves without saying by how much makes the reader do the
 * subtraction; the pill does it, and says against what — « depuis votre
 * dernier passage », the session memory's reference (option A of the spec:
 * what this session last showed, nothing stored). Arrives after the roll
 * (DeltaPill.css) and is absent for a figure that did not move.
 */
export function DeltaPill({
  delta,
  format,
  upIsGood,
  since = "depuis votre dernier passage",
}: DeltaPillProps) {
  if (delta === 0) return null;
  const good = delta > 0 === upIsGood;
  return (
    <span className={`yd-delta-pill yd-num yd-delta-pill--${good ? "good" : "bad"}`}>
      {`${delta > 0 ? "+" : MINUS}${format(Math.abs(delta))} ${since}`}
    </span>
  );
}
