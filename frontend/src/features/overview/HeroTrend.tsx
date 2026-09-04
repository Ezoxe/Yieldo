import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import type { SeriesBucket } from "../../lib/types";
import { Sparkline, SPARKLINE_VIEWBOX_HEIGHT, sparklinePoints } from "./StatTile";

interface HeroTrendProps {
  /** The buckets the series was measured over — one per point, same order. */
  buckets: SeriesBucket[];
  /** The running total at each bucket. `cumulativeNetCents(buckets)`. */
  values: number[];
}

/**
 * The hero's trend band, and the one reading the reader asks for.
 *
 * A sparkline with no scale is a shape, not a measurement: it says the balance
 * fell without saying from what to what. The pointer (or the arrow keys) puts
 * a cursor on a bucket and prints that bucket's own running total beside it —
 * the same quantity the figure above the band shows for the whole period.
 *
 * Geometry comes from `sparklinePoints`, the same function that drew the line.
 * Recomputing it here would put the cursor a pixel off the curve the moment
 * either copy was touched.
 */
export function HeroTrend({ buckets, values }: HeroTrendProps) {
  // null = nothing is being pointed at, which is the resting state. Never 0 as
  // a stand-in: index 0 is a real bucket.
  const [active, setActive] = useState<number | null>(null);
  const points = sparklinePoints(values);

  function indexFromPointer(event: PointerEvent<HTMLDivElement>): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return 0;
    const ratio = (event.clientX - bounds.left) / bounds.width;
    const nearest = Math.round(ratio * (values.length - 1));
    return Math.min(values.length - 1, Math.max(0, nearest));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // The band is a control now, and a control that scrolls the page while it
    // is being read is a broken one.
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    setActive((current) => {
      const from = current ?? (step > 0 ? -1 : values.length);
      return Math.min(values.length - 1, Math.max(0, from + step));
    });
  }

  const point = active === null ? null : points[active];
  const bucket = active === null ? null : buckets[active];

  return (
    <div
      className="yd-hero__plot"
      // Focusable and arrow-navigable: the reading this band offers must not be
      // reachable by pointer alone.
      tabIndex={0}
      role="img"
      aria-label={
        buckets.length > 0
          ? `Solde cumulé, du ${frenchDate(buckets[0].start)} au ${frenchDate(buckets[buckets.length - 1].end)}. Utilisez les flèches gauche et droite pour lire chaque point.`
          : "Solde cumulé sur la période."
      }
      onPointerMove={(event) => setActive(indexFromPointer(event))}
      onPointerLeave={() => setActive(null)}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
    >
      <Sparkline values={values} className="yd-hero__spark" filled endMarker />

      {point !== null && bucket !== null ? (
        <>
          <span
            className="yd-hero__cursor"
            style={{ left: `${point.x}%` }}
            aria-hidden="true"
          />
          <span
            className="yd-hero__cursor-dot"
            style={{
              left: `${point.x}%`,
              top: `${(point.y / SPARKLINE_VIEWBOX_HEIGHT) * 100}%`,
            }}
            aria-hidden="true"
          />
          {/* `role="status"`: reading a point is not an alert, and an assertive
              announcement on every arrow key would talk over itself. */}
          <span
            className="yd-hero__readout"
            role="status"
            // Pinned to the side the cursor is NOT on once it passes the
            // halfway mark, so the label never runs off the card.
            data-side={point.x > 60 ? "left" : "right"}
            style={{ left: `${point.x}%` }}
          >
            <span className="yd-hero__readout-date">{frenchDate(bucket.start)}</span>
            <span className="yd-hero__readout-value yd-num">
              {formatCents(values[active as number], { signed: true })}
            </span>
          </span>
        </>
      ) : null}
    </div>
  );
}
