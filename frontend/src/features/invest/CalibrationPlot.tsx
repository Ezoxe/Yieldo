import { formatBps, formatProbability } from "./format";
import type { InvestCalibrationBucket } from "../../lib/types";
import "./invest.css";

interface CalibrationPlotProps {
  buckets: InvestCalibrationBucket[];
}

// The plot's own coordinate space. Rendered into a viewBox so it scales with
// its cell rather than being measured in the browser; 0..100 on both axes,
// because both axes ARE percentages.
const SIZE = 100;
const PADDING = 12;

function x(bps: number): number {
  return PADDING + (bps / 10_000) * (SIZE - 2 * PADDING);
}

function y(bps: number): number {
  // SVG's y grows downward and a probability grows upward.
  return SIZE - PADDING - (bps / 10_000) * (SIZE - 2 * PADDING);
}

/**
 * Stated probability against what actually happened — the reliability plot.
 *
 * The one measurement that judges a decision MODEL rather than a strategy. A
 * point on the diagonal means the model's numbers mean what they say: of the
 * times it said 70 %, seventy in a hundred happened. Above the line it was too
 * cautious, below it too confident.
 *
 * **One series, so no legend** — the title names it. The diagonal is drawn in
 * a recessive ink and labelled in the caption rather than in a legend box,
 * because it is a reference, not a second series.
 *
 * **Position carries the whole message, so colour carries none of it.** Every
 * dot is the one accent hue. Tinting the dots by how far they sit from the
 * line would encode in colour exactly what the reader is already reading off
 * the axis, and would spend two of the app's reserved status hues on it.
 *
 * Marker area grows with the number of observations in the band, so a point
 * resting on four decisions cannot look as solid as one resting on eighty.
 * The table under it is not a fallback: it is where the counts are readable.
 */
export function CalibrationPlot({ buckets }: CalibrationPlotProps) {
  const heaviest = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <figure className="yd-calib">
      <svg
        className="yd-calib__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={
          "Probabilité annoncée par le modèle en abscisse, fréquence réellement observée "
          + "en ordonnée. La diagonale est la calibration parfaite. Le tableau qui suit "
          + "donne les mêmes chiffres."
        }
      >
        {/* The frame, recessive. */}
        <line className="yd-calib__axis" x1={PADDING} y1={SIZE - PADDING}
              x2={SIZE - PADDING} y2={SIZE - PADDING} />
        <line className="yd-calib__axis" x1={PADDING} y1={PADDING}
              x2={PADDING} y2={SIZE - PADDING} />
        {/* Perfect calibration. Dashed so it reads as a reference rather than
            as data. */}
        <line className="yd-calib__diagonal" x1={x(0)} y1={y(0)}
              x2={x(10_000)} y2={y(10_000)} />
        {buckets.map((bucket) => {
          const middle = (bucket.lower_bps + bucket.upper_bps) / 2;
          return (
            <circle
              key={bucket.lower_bps}
              className="yd-calib__dot"
              cx={x(bucket.stated_bps || middle)}
              cy={y(bucket.observed_bps)}
              // Area, not radius, grows with the count: a radius proportional
              // to n would overstate a heavy band by its square.
              r={2 + 2.6 * Math.sqrt(bucket.count / heaviest)}
            >
              <title>
                {`Annoncé ${formatProbability(bucket.stated_bps)}, observé `
                  + `${formatProbability(bucket.observed_bps)}, sur ${bucket.count} décision(s)`}
              </title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="yd-calib__caption">
        La diagonale est la calibration parfaite. Au-dessus, le modèle est trop prudent&nbsp;;
        en dessous, trop sûr de lui. La taille d'un point est le nombre de décisions
        derrière lui.
      </figcaption>

      <div className="yd-scroll-x">
        <table className="yd-table yd-calib__table">
          <caption className="yd-visually-hidden">
            Probabilité annoncée, fréquence observée et écart, par tranche de 10&nbsp;%
          </caption>
          <thead>
            <tr>
              <th scope="col">Tranche</th>
              <th scope="col">Annoncé</th>
              <th scope="col">Observé</th>
              <th scope="col">Écart</th>
              <th scope="col">Décisions</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.lower_bps}>
                <th scope="row" className="yd-num">
                  {formatProbability(bucket.lower_bps)} – {formatProbability(bucket.upper_bps)}
                </th>
                <td className="yd-num">{formatProbability(bucket.stated_bps)}</td>
                <td className="yd-num">{formatProbability(bucket.observed_bps)}</td>
                {/* Signed: the direction of the error is the whole point of
                    the column, and an unsigned 4 % would hide it. */}
                <td className="yd-num">
                  {formatBps(bucket.gap_bps, { signed: true, decimals: 0 })}
                </td>
                <td className="yd-num">{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
