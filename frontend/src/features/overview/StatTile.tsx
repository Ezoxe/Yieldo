import { CountUp } from "../../design/CountUp";
import { formatCents } from "../../design/theme";
import "./StatTile.css";

export type StatTileTone = "neutral" | "good" | "bad";

interface StatTileProps {
  label: string;
  valueCents: number | null;
  deltaCents?: number;
  tone?: StatTileTone;
  sparkline?: number[];
  /** Defaults to formatCents. Override for a tile whose raw number is not an
   * amount in cents (e.g. the savings-rate tile, which passes a ratio) --
   * `valueCents` still carries the raw value to format either way. */
  format?: (value: number) => string;
}

interface SparklineProps {
  values: number[];
  /**
   * Class on the `<svg>`. The caller owns the box (this component has no
   * intrinsic size worth trusting) and, through `--yd-sparkline-line` /
   * `--yd-sparkline-dot`, the two colours.
   */
  className?: string;
}

/**
 * A bare trend line: no axes, no labels, just the shape of a series.
 *
 * `preserveAspectRatio="none"` stretches the 100x24 viewBox to whatever box
 * the caller gives it, and the two callers differ by an order of magnitude
 * (a 24px tile strip, a 260px hero band). So nothing drawn here may carry its
 * thickness in user units: both marks use `vector-effect="non-scaling-stroke"`,
 * which pins the stroke to CSS pixels whatever the scale. That also rules out
 * a `<circle>` for the end marker -- a circle in a non-uniformly scaled
 * coordinate system is an ellipse -- so the marker is a zero-length line with
 * a round cap, which renders as a dot of exactly `strokeWidth` pixels.
 */
export function Sparkline({ values, className = "" }: SparklineProps) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const toXY = (value: number, index: number) => {
    const x = (index / (values.length - 1)) * 100;
    // A series that never moved is flat through the middle of the band. The
    // arithmetic fallback for a zero range used to put it on the floor, which
    // draws a number that held steady as a number at its lowest.
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const y = 22 - ratio * 20 - 1;
    return [x, y] as const;
  };
  const points = values.map((value, index) => toXY(value, index).join(",")).join(" ");
  const [lastX, lastY] = toXY(values[values.length - 1], values.length - 1);

  return (
    <svg className={className} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline
        points={points}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--yd-sparkline-line, var(--yd-text-muted))" }}
      />
      <line
        x1={lastX}
        y1={lastY}
        x2={lastX}
        y2={lastY}
        strokeWidth={6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--yd-sparkline-dot, var(--yd-accent))" }}
      />
    </svg>
  );
}

// Renders the tile's *contents* only: on the dashboard the surface is the
// bento cell around it (opaque, hairline, shadow), so a card of its own here
// would nest one surface inside another. It also used to be a GlassCard
// marked `interactive`, which put a pointer cursor and a hover lift on a
// plain div nothing could click or focus -- an affordance that promised
// something the tile never did.
//
// Never renders a zero standing in for an unknown: when valueCents is null
// (e.g. a savings rate with no income to divide by) the tile says so in
// words instead of showing a number -- and a delta against an unknown
// baseline is meaningless, so it is suppressed too.
export function StatTile({ label, valueCents, deltaCents, sparkline, format = formatCents }: StatTileProps) {
  const unavailable = valueCents === null;
  const deltaGood = deltaCents !== undefined && deltaCents >= 0;

  return (
    <div className="yd-stat-tile">
      <span className="yd-stat-tile__label">{label}</span>
      {unavailable ? (
        <p className="yd-stat-tile__unavailable">Donnée indisponible</p>
      ) : (
        <>
          <CountUp value={valueCents} format={format} className="yd-stat-tile__value" />
          {deltaCents !== undefined ? (
            <span className={`yd-stat-tile__delta yd-stat-tile__delta--${deltaGood ? "good" : "bad"}`}>
              {formatCents(deltaCents, { signed: true })}
            </span>
          ) : null}
          {sparkline && sparkline.length > 1 ? (
            <Sparkline values={sparkline} className="yd-stat-tile__sparkline" />
          ) : null}
        </>
      )}
    </div>
  );
}
