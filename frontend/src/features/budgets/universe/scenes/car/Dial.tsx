import type { CSSProperties } from "react";

import type { Gauge } from "../../readings";
import { DIAL } from "./geometry";

function point(share: number, radius: number): [number, number] {
  const angle = Math.PI * share;
  return [DIAL.cx - radius * Math.cos(angle), DIAL.cy - radius * Math.sin(angle)];
}

const round = (value: number) => Number(value.toFixed(2));

/**
 * The fuel-gauge dial: the page's own ceiling, E for spent and F for
 * untouched. The needle's resting angle IS the reading — the entrance
 * animation only brings it there — so a reader with motion off sees the same
 * figure. The reserve light burns once the budget is at risk, over, or under
 * a quarter left.
 */
export function Dial({ gauge }: { gauge: Gauge }) {
  const { cx, cy, r, arc } = DIAL;
  const [endX, endY] = point(gauge.share, arc);
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map((share) => {
      const [x1, y1] = point(share, 17);
      const [x2, y2] = point(share, 20);
      return `M${round(x1)},${round(y1)} L${round(x2)},${round(y2)}`;
    })
    .join(" ");
  const needle = { "--needle": `${-90 + gauge.share * 180}deg`, transformOrigin: `${cx}px ${cy}px` } as CSSProperties;
  const reserve = gauge.status !== "ok" || gauge.share < 0.25;

  return (
    <g className={`yd-car__dial yd-car__dial--${gauge.status}`}>
      <circle cx={cx} cy={cy} r={r} className="yd-dial__face" />
      <path d={`M${cx - arc},${cy} A${arc},${arc} 0 0 1 ${cx + arc},${cy}`} className="yd-dial__track" />
      {gauge.share > 0 ? (
        <path d={`M${cx - arc},${cy} A${arc},${arc} 0 0 1 ${round(endX)},${round(endY)}`} className="yd-dial__level" />
      ) : null}
      <path d={ticks} className="yd-dial__ticks" />
      <g className="yd-dial__needle" style={needle}>
        <path d={`M${cx - 2.2},${cy} L${cx},${cy - 21} L${cx + 2.2},${cy} Z`} />
      </g>
      <circle cx={cx} cy={cy} r={3.6} className="yd-dial__hub" />
      {reserve ? <circle cx={cx} cy={cy + 12} r={2.5} className="yd-dial__reserve" /> : null}
      <text x={cx - 19} y={cy + 17} textAnchor="middle" className="yd-dial__letter">
        E
      </text>
      <text x={cx + 19} y={cy + 17} textAnchor="middle" className="yd-dial__letter">
        F
      </text>
    </g>
  );
}
