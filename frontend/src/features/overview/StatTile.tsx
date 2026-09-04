import { useId, type ReactNode } from "react";

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
   * colour. What turns a hairline into a shape at 40px tall.
   */
  filled?: boolean;
  /**
   * The dot on the last reading. Defaults to on for an unfilled line and off
   * for a filled one — a filled band is bled to its container's edges, where
   * the marker would be sliced down the middle by the clip.
   */
  endMarker?: boolean;
}

/** One point of a sparkline, in the 100x24 viewBox the drawing is laid out in. */
export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Where every value of a series lands in the 100x24 viewBox.
 *
 * Exported because anything drawn OVER a sparkline — the hero's hover cursor,
 * for one — has to land on exactly the point the line was drawn at. A second
 * copy of this arithmetic beside the first is how a crosshair ends up a pixel
 * off the curve it is supposed to be reading.
 */
export function sparklinePoints(values: number[]): SparklinePoint[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((value, index) => ({
    x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
    // A series that never moved is flat through the middle of the band. The
    // arithmetic fallback for a zero range used to put it on the floor, which
    // draws a number that held steady as a number at its lowest.
    y: 22 - (max === min ? 0.5 : (value - min) / (max - min)) * 20 - 1,
  }));
}

/** The viewBox height `sparklinePoints` maps into — the divisor anything
 *  positioning itself over the drawing needs. */
export const SPARKLINE_VIEWBOX_HEIGHT = 24;

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
export function Sparkline({
  values,
  className = "",
  filled = false,
  endMarker = !filled,
}: SparklineProps) {
  const geometry = sparklinePoints(values);
  const points = geometry.map((point) => `${point.x},${point.y}`).join(" ");
  const last = geometry[geometry.length - 1];
  // One gradient per instance: two sparklines on the same page sharing an id
  // would both resolve to whichever <defs> the browser saw last.
  const fillId = useId().replace(/:/g, "");
  // The line, closed down to the floor of the viewBox and back. Only used when
  // `filled` — an unclosed polyline cannot be filled without the fill cutting
  // the chord between its first and last point.
  const area = `0,24 ${points} 100,24`;

  return (
    <svg className={className} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {filled ? (
        <>
          {/* A vertical fade, not a flat wash: the same shape the ECharts
              plots below the hero put under their own lines (`areaFade` in
              charts/theme.ts). A single opaque colour under a curve reads as a
              filled block, which is a different chart.

              BOTH stops are the same colour, and only the opacity moves. The
              second used to be `transparent`, which is `rgba(0, 0, 0, 0)` —
              SVG interpolates the RGB channels as well as the alpha, so the
              fill travelled from indigo to BLACK on its way down and came out
              a dull grey wash. Fading within one hue is the whole fix. */}
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0"
                style={{ stopColor: "var(--yd-sparkline-line)" }}
                stopOpacity={0.22}
              />
              <stop
                offset="1"
                style={{ stopColor: "var(--yd-sparkline-line)" }}
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${fillId})`} />
        </>
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
      {endMarker ? (
        <line
          x1={last.x}
          y1={last.y}
          x2={last.x}
          y2={last.y}
          strokeWidth={6}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: "var(--yd-sparkline-dot, var(--yd-accent))" }}
        />
      ) : null}
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
