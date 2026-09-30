import type { CSSProperties, ReactNode } from "react";

import { LensFrame, lensState } from "../shared/LensFrame";

import type { CarPart } from "../../registry";
import type { PartReading } from "../../readings";
import type { SceneIds } from "./defs";
import {
  BODY_PATH,
  DOOR_WINDOW_PATH,
  FRONT_WHEEL,
  LENSES,
  REAR_DOOR_EDGE,
  REAR_QUARTER_PATH,
  REAR_WHEEL,
  TANK,
} from "./geometry";

/** How long each lens takes to sweep, so the four never pulse in step. */
const SWEEP_SECONDS: Record<CarPart, number> = { fuel: 2.6, engine: 3.1, cage: 2.2, toll: 1.8 };

const FUEL_WAVE =
  "M435,140 q7.75,-2 15.5,0 t15.5,0 t15.5,0 t15.5,0 t15.5,0 t15.5,0 t15.5,0 V200 H435 Z";

/**
 * The tank, behind the front axle. Its liquid is drawn full and lowered by
 * `--drop`: that is the resting state a stopped animation shows, so with
 * motion off the tank simply stands at its true level. No level to show (no
 * ceiling, no mean yet): the tank is drawn empty of liquid rather than full
 * or empty of a figure it does not have.
 */
function FuelContents({ reading, ids }: { reading: PartReading; ids: SceneIds }) {
  const { level } = reading;
  const tone = reading.status ?? "neutral";
  const drop = { "--drop": `${level === null ? 0 : (1 - level.share) * TANK.height}px` } as CSSProperties;
  return (
    <>
      <circle cx={FRONT_WHEEL.cx} cy={FRONT_WHEEL.cy} r={FRONT_WHEEL.tire} className="yd-lens__ghost yd-lens__ghost--strong" />
      <circle cx={FRONT_WHEEL.cx} cy={FRONT_WHEEL.cy} r={FRONT_WHEEL.rim} className="yd-lens__ghost" />
      <ellipse cx="476.1" cy="132.5" rx="10.7" ry="5.7" className="yd-lens__ghost" />
      <path d="M468,162 C462,166 452,168 440,168.5" className="yd-lens__fuel-pipe" />
      <path d="M468,162 C462,166 452,168 440,168.5" className="yd-lens__fuel-flow" />
      <path d="M473,141 C473.5,138 474.5,135.5 476,133.5" className="yd-lens__fuel-neck" />
      <path d={TANK.path} className="yd-lens__tank-shell" />
      {level !== null ? (
        <g clipPath={`url(#${ids.tankClip})`}>
          <g className="yd-lens__fuel" style={drop}>
            <path className="yd-lens__wave" d={FUEL_WAVE} fill={`url(#${ids.fuel})`} />
          </g>
        </g>
      ) : null}
      <path d={TANK.path} className={`yd-lens__tank yd-lens__state--${tone}`} />
      <path d="M472,143.5 H492" className="yd-lens__tank-gleam" />
      <path d="M466,146 h3 M466,152 h3 M466,158 h3" className="yd-lens__marks" />
    </>
  );
}

/** The flat-six behind the rear axle: pistons, pulley, a hot header. */
function EngineContents({ ids }: { ids: SceneIds }) {
  return (
    <>
      <circle cx={REAR_WHEEL.cx} cy={REAR_WHEEL.cy} r={REAR_WHEEL.tire} className="yd-lens__ghost yd-lens__ghost--strong" />
      <path d="M192,146 C194,138 232,137 236,143 L236,148 L192,148 Z" fill={`url(#${ids.engine})`} className="yd-lens__metal-edge" />
      <rect x="190" y="147.5" width="48" height="9" rx="3" className="yd-lens__head" />
      <rect x="188" y="156" width="52" height="26" rx="4" fill={`url(#${ids.engine})`} className="yd-lens__block" />
      {[193, 208, 223].map((x) => (
        <rect key={x} x={x} y="159" width="11" height="19" rx="1.5" className="yd-lens__bore" />
      ))}
      {[194, 209, 224].map((x, index) => (
        <rect
          key={x}
          x={x}
          y="160"
          width="9"
          height="6"
          rx="1"
          className="yd-lens__piston"
          style={{ animationDelay: `${-0.15 * index}s` }}
        />
      ))}
      <g className="yd-car__spin yd-lens__pulley" style={{ transformOrigin: "186px 166px" }}>
        <circle cx="186" cy="166" r="5" />
        <path d="M186,162 V165" />
      </g>
      <path d="M200,182 C197,188 190,190 182,190" className="yd-lens__header-heat" />
      <path d="M200,182 C197,188 190,190 182,190" className="yd-lens__header" />
    </>
  );
}

const CAGE = "M330,92.5 C316,99 298,109 280,119 M321.4,115.3 C312,111.5 300,106 291.9,102.1";

/** The roll cage, seen through the rear quarter window. */
function CageContents() {
  return (
    <>
      <path d={REAR_QUARTER_PATH} className="yd-lens__ghost" />
      <path d={REAR_DOOR_EDGE} className="yd-lens__ghost" />
      <path d="M312,134 C311,122 312,108 318,104 C322,102 326,104 326,110 L326,134" className="yd-lens__ghost" />
      <g className="yd-lens__cage">
        <path d={CAGE} className="yd-lens__tube" />
        <path d={CAGE} className="yd-lens__tube-core" />
      </g>
    </>
  );
}

/** The toll badge on the windscreen, behind the mirror; it lights as a gantry passes. */
function TollContents() {
  return (
    <>
      <path d={DOOR_WINDOW_PATH} className="yd-lens__ghost" />
      <path d="M394.4,87.4 L438.6,121.8" className="yd-lens__ghost" />
      <path d="M403,88.8 L406,92.2" className="yd-lens__mirror-stem" />
      <rect x="401" y="92.2" width="10" height="4" rx="2" className="yd-lens__mirror" />
      <g transform="rotate(26.6 414.5 95)">
        <rect x="411" y="93" width="7" height="4" rx="1" className="yd-lens__badge" />
      </g>
      <circle cx="414.5" cy="95" r="1.4" className="yd-lens__beep" />
    </>
  );
}

export function Lens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: SceneIds;
  onSelect?: () => void;
}) {
  const contents: Record<CarPart, ReactNode> = {
    fuel: <FuelContents reading={reading} ids={ids} />,
    engine: <EngineContents ids={ids} />,
    cage: <CageContents />,
    toll: <TollContents />,
  };
  const { cx, cy, r } = LENSES[reading.part as CarPart];
  return (
    <LensFrame
      part={reading.part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={BODY_PATH} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[reading.part as CarPart]}
      onSelect={onSelect}
    >
      {contents[reading.part as CarPart]}
    </LensFrame>
  );
}
