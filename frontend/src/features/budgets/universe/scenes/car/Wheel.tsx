import type { CSSProperties } from "react";

import type { SceneIds } from "./defs";
import type { WheelGeometry } from "./geometry";

/**
 * One wheel: tyre, drilled disc, the yellow caliper that does NOT turn, and
 * five gold double spokes around a centre-lock nut, which do.
 */
export function Wheel({ geometry: g, ids }: { geometry: WheelGeometry; ids: SceneIds }) {
  const spin = { transformOrigin: `${g.cx}px ${g.cy}px` } as CSSProperties;
  return (
    <g className="yd-car__wheel">
      <circle cx={g.cx} cy={g.cy} r={g.tire} fill={`url(#${ids.tire})`} />
      <path d={g.tread} className="yd-car__tread" />
      <circle cx={g.cx} cy={g.cy} r={g.rim} className="yd-car__barrel" />
      <g className="yd-car__spin" style={spin}>
        <circle cx={g.cx} cy={g.cy} r={g.disc} fill={`url(#${ids.disc})`} />
        <circle cx={g.cx} cy={g.cy} r={g.holes} className="yd-car__holes" strokeDasharray={g.holesDash} />
        <circle cx={g.cx} cy={g.cy} r={g.hat} className="yd-car__hat" />
      </g>
      <path d={g.caliper} className="yd-car__caliper" />
      <path d={g.caliperGleam} className="yd-car__caliper-gleam" />
      <g className="yd-car__spin" style={spin}>
        <path d={g.spokes} className="yd-car__spokes-shadow" />
        <path d={g.spokes} className="yd-car__spokes" />
        <circle cx={g.cx} cy={g.cy} r={g.nut} className="yd-car__nut" />
        <circle cx={g.cx} cy={g.cy} r={g.nut * 0.36} className="yd-car__nut-core" />
      </g>
      <circle cx={g.cx} cy={g.cy} r={g.rim} fill={`url(#${ids.rimShade})`} />
      <circle cx={g.cx} cy={g.cy} r={g.rim} className="yd-car__rim-lip" />
      <circle cx={g.cx} cy={g.cy} r={g.rim - 1.6} className="yd-car__rim-inner" />
      <path d={g.gleam} className="yd-car__rim-gleam" />
    </g>
  );
}
