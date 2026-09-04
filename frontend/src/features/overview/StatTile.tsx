import type { ReactNode } from "react";

import { CountUp } from "../../design/CountUp";
import type { IconComponent } from "../../design/icons";
import { IconBadge, TrendDownIcon, TrendUpIcon, type IconTone } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { formatCents } from "../../design/theme";
import "./StatTile.css";

export type StatTileTone = "neutral" | "good" | "bad";

interface StatTileProps {
  label: string;
  valueCents: number | null;
  deltaCents?: number;
  tone?: StatTileTone;
  sparkline?: number[];
  /** The tile's mark. A figure with no mark beside it is a number on a card;
   *  with one, the reader finds "Entrées" across the grid without reading. */
  icon?: IconComponent;
  /** What the mark is tinted by — the meaning, never a colour name. */
  iconTone?: IconTone;
  /** How this figure was measured. Folded behind the mark rather than printed
   *  under the number — see design/InfoTip.tsx. */
  hint?: ReactNode;
  /**
   * Defaults to formatCents. Override for a tile whose raw number is not an
   * amount in cents (e.g. the savings-rate tile, which passes a ratio) --
   * `valueCents` still carries the raw value to format either way.
   */
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
  /**
   * Fills the area under the line with a vertical fade of the line's own
   * colour. What turns a hairline into a shape at 40px tall — used by the
   * tile's background band, not by the hero's own plot.
   */
  filled?: boolean;
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
export function Sparkline({ values, className = "", filled = false }: SparklineProps) {
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
  // The line, closed down to the floor of the viewBox and back. Only used when
  // `filled` — an unclosed polyline cannot be filled without the fill cutting
  // the chord between its first and last point.
  const area = `0,24 ${points} 100,24`;

  return (
    <svg className={className} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {filled ? (
        <polygon points={area} style={{ fill: "var(--yd-sparkline-fill, transparent)" }} />
      ) : null}
      <polyline
        points={points}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--yd-sparkline-line, var(--yd-text-muted))" }}
      />
      {filled ? null : (
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
      )}
    </svg>
  );
}

// Renders the tile's *contents* only: on the dashboard the surface is the
// bento cell around it (opaque, hairline, shadow), so a card of its own here
// would nest one surface inside another.
//
// Never renders a zero standing in for an unknown: when valueCents is null
// (e.g. a savings rate with no income to divide by) the tile says so in
// words instead of showing a number -- and a delta against an unknown
// baseline is meaningless, so it is suppressed too.
export function StatTile({
  label,
  valueCents,
  deltaCents,
  sparkline,
  icon,
  iconTone = "accent",
  hint,
  format = formatCents,
}: StatTileProps) {
  const unavailable = valueCents === null;
  const deltaGood = deltaCents !== undefined && deltaCents >= 0;
  const DeltaIcon = deltaGood ? TrendUpIcon : TrendDownIcon;

  return (
    <div className="yd-stat-tile">
      <span className="yd-stat-tile__head">
        {icon ? <IconBadge icon={icon} tone={iconTone} small /> : null}
        <span className="yd-stat-tile__label">{label}</span>
        {hint ? <InfoTip label={`Comment « ${label} » est mesuré`}>{hint}</InfoTip> : null}
      </span>
      {unavailable ? (
        <p className="yd-stat-tile__unavailable">Donnée indisponible</p>
      ) : (
        <>
          <CountUp value={valueCents} format={format} className="yd-stat-tile__value" />
          {deltaCents !== undefined ? (
            // A pill, not a sentence: three words of context under every figure
            // is what made this dashboard read as prose with numbers in it.
            <span
              className={`yd-stat-tile__delta yd-stat-tile__delta--${deltaGood ? "good" : "bad"}`}
            >
              <DeltaIcon />
              {formatCents(deltaCents, { signed: true })}
            </span>
          ) : null}
          {sparkline && sparkline.length > 1 ? (
            // Behind the figure, bled to the card's edges, at low opacity: the
            // shape of the period is context for the number, never a second
            // thing to read.
            <Sparkline values={sparkline} className="yd-stat-tile__sparkline" filled />
          ) : null}
        </>
      )}
    </div>
  );
}
