/**
 * The health score as a ring, and the one word that says what it means.
 *
 * A bare numeral on a card ("32") makes the reader do the interpretation:
 * out of what, and is that good? The ring answers the first by being a ring,
 * and the band answers the second in a word.
 *
 * The three bands are the engine's own, not invented here — see
 * `backend/app/engines/health_score.py`. Colour is never the only carrier:
 * the word beside it says the same thing (WCAG 1.4.1), and the numeral is
 * still the largest thing in the component, because the score is a
 * measurement and the band is a reading of it.
 */
export type ScoreBand = "fragile" | "balanced" | "solid";

export interface BandReading {
  band: ScoreBand;
  label: string;
  /** The token the ring and the word are both painted in. */
  color: string;
}

const BANDS: Record<ScoreBand, BandReading> = {
  fragile: { band: "fragile", label: "Fragile", color: "var(--yd-negative)" },
  balanced: { band: "balanced", label: "Équilibré", color: "var(--yd-warning)" },
  solid: { band: "solid", label: "Solide", color: "var(--yd-positive)" },
};

/** Which band a 0-100 score falls in. Exported so the test asserts the
 *  boundaries rather than the drawing. */
export function bandFor(score: number): BandReading {
  if (score < 40) return BANDS.fragile;
  if (score < 70) return BANDS.balanced;
  return BANDS.solid;
}

interface ScoreGaugeProps {
  /** 0-100. A score that could not be measured is not passed here at all —
   *  the caller prints "Non calculable" instead, because an empty ring and a
   *  ring at zero are two different claims. */
  score: number;
}

/** Geometry of the arc, in the SVG's own units. */
const SIZE = 132;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
/** A three-quarter ring, opened at the bottom: a full circle reads as a pie
 *  chart of one slice, and the gap is where the reading sits. */
const SWEEP = 0.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreGauge({ score }: ScoreGaugeProps) {
  const reading = bandFor(score);
  const clamped = Math.min(100, Math.max(0, score));
  const track = CIRCUMFERENCE * SWEEP;
  const filled = track * (clamped / 100);

  return (
    <div className="yd-gauge" data-band={reading.band}>
      {/* The ring and its reading share one positioned box, and the band word
          sits outside it. The reading used to be absolute against the whole
          column — svg plus gap plus word — so "50 %" of that column landed
          below the ring's own centre, and the numeral sat low in the circle.
          Nudging the percentage down to 46 % only made the error smaller. */}
      <div className="yd-gauge__dial">
        <svg
          className="yd-gauge__ring"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          aria-hidden="true"
          focusable="false"
        >
          {/* Rotated so the opening sits at the bottom and the arc starts from
              the lower left, which is where a gauge is read from. */}
          <g transform={`rotate(135 ${SIZE / 2} ${SIZE / 2})`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${track} ${CIRCUMFERENCE}`}
              className="yd-gauge__track"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
              className="yd-gauge__fill"
              style={{ stroke: reading.color }}
            />
          </g>
        </svg>

        <div className="yd-gauge__reading">
          <p className="yd-gauge__score yd-num" data-testid="yd-health-score">
            {score}
          </p>
          <p className="yd-gauge__scale">sur 100</p>
        </div>
      </div>

      <p className="yd-gauge__band" style={{ color: reading.color }}>
        {reading.label}
      </p>
    </div>
  );
}
