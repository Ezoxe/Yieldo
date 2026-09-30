import type { CSSProperties, ReactNode } from "react";

import type { HousePart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { HouseIds } from "./defs";
import { HOUSE_OUTLINE, LENSES, METER_BARS, ROOF_PATH } from "./geometry";

const SWEEP_SECONDS: Record<HousePart, number> = {
  roof: 2.6,
  door: 2.1,
  net: 1.9,
  power: 2.4,
  water: 2.2,
  workshop: 2.8,
};

const RAFTERS = "M140,152 L232,76 M150,152 L236,82 M168,152 L240,92 M186,152 L246,102 M204,152 L250,116";
const PURLINS = "M160,134 H240 M182,112 H240 M204,96 H240";

/** The roof frame under the tiles: what the home insurance protects. */
function RoofContents() {
  return (
    <g className="yd-lens__frame">
      <path d={RAFTERS} className="yd-lens__timber" />
      <path d={RAFTERS} className="yd-lens__timber-core" />
      <path d={PURLINS} className="yd-lens__timber" />
      <path d={PURLINS} className="yd-lens__timber-core" />
    </g>
  );
}

/** The lock of the front door, a key turning in it and the bolt it moves. */
function DoorContents() {
  return (
    <>
      <rect x="274" y="226" width="14" height="20" className="yd-lens__ghost" />
      <g className="yd-lens__bolt">
        <rect x="268" y="233" width="16" height="5" rx="1.2" className="yd-lens__steel" />
      </g>
      <rect x="254" y="228" width="16" height="16" rx="3" className="yd-lens__lock" />
      <circle cx="262" cy="236" r="5" className="yd-lens__cylinder" />
      <g className="yd-lens__key">
        <path d="M262,236 H247 M250,236 V239 M253,236 V238.5" className="yd-lens__key-blade" />
        <circle cx="244" cy="236" r="3.6" className="yd-lens__key-bow" />
      </g>
    </>
  );
}

/** The box on its shelf behind the window, its lights, its wifi, and a phone. */
function NetContents() {
  return (
    <>
      <path d="M349,188 V238" className="yd-lens__ghost" />
      <rect x="334" y="222" width="30" height="3" className="yd-lens__shelf" />
      <rect x="336" y="213" width="20" height="9" rx="2" className="yd-lens__box" />
      <circle cx="340" cy="217.5" r="1.2" className="yd-lens__led yd-lens__led--slow" />
      <circle cx="344" cy="217.5" r="1.2" className="yd-lens__led yd-lens__led--fast" />
      <circle cx="348" cy="217.5" r="1.2" className="yd-lens__led yd-lens__led--blue" />
      <circle cx="352" cy="217.5" r="1.2" className="yd-lens__led" />
      {[
        ["M340,208 Q346,203 352,208", 0],
        ["M337,205 Q346,197 355,205", 0.5],
        ["M334,202 Q346,191 358,202", 1],
      ].map(([d, delay]) => (
        <path key={String(d)} d={String(d)} className="yd-lens__wifi" style={{ animationDelay: `${delay}s` }} />
      ))}
      <rect x="358" y="209" width="6" height="12" rx="1.3" className="yd-lens__phone" />
      <rect x="359" y="210.5" width="4" height="8" className="yd-lens__phone-screen" />
    </>
  );
}

/**
 * The electricity meter in the low wall. Its display is the house's gauge:
 * five bars, as many lit as fifths of the energy budget (or of its monthly
 * mean) still unspent — none lit, and no state, when there is no level to
 * show. The lit bars come on one after the other and stay on the true count.
 */
function PowerContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const lit = level === null ? 0 : Math.round(level.share * METER_BARS);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <rect x="500" y="236" width="18" height="22" rx="1.5" className="yd-lens__ghost" />
      <path d="M509,258 V272 M513,258 C516,264 520,266 530,266" className="yd-lens__cable" />
      <path d="M509,258 V272 M513,258 C516,264 520,266 530,266" className="yd-lens__current" />
      <rect x="498" y="228" width="22" height="30" rx="3" className="yd-lens__meter" />
      <rect x="501" y="232" width="16" height="9" rx="1" className="yd-lens__display" />
      {Array.from({ length: METER_BARS }, (_, index) => (
        <rect
          key={index}
          x={502 + index * 3}
          y="234.5"
          width="2"
          height="4"
          className={index < lit ? `yd-lens__bar yd-lens__bar--lit yd-lens__bar--${tone}` : "yd-lens__bar"}
          style={{ animationDelay: `${0.25 * index}s` } as CSSProperties}
          data-lit={index < lit ? "true" : undefined}
        />
      ))}
      <circle cx="509" cy="248" r="1.8" className="yd-lens__pulse" />
      <rect x="502" y="252" width="14" height="2" rx="1" className="yd-lens__meter-label" />
      <rect x="498" y="228" width="22" height="30" rx="3" className={`yd-lens__meter-edge yd-lens__state--${tone}`} />
    </>
  );
}

/** The water meter in its pit, the water running through it. */
function WaterContents() {
  return (
    <>
      <rect x="436" y="282" width="32" height="26" rx="3" className="yd-lens__ghost" />
      <path d="M420,300 H484" className="yd-lens__pipe" />
      <path d="M420,300 H484" className="yd-lens__water" />
      <circle cx="452" cy="296" r="9" className="yd-lens__gauge" />
      <g className="yd-lens__spin" style={{ transformOrigin: "452px 296px" }}>
        <path d="M452,289 V303 M445,296 H459 M447,291 L457,301 M457,291 L447,301" className="yd-lens__vanes" />
      </g>
      <circle cx="452" cy="296" r="2" className="yd-lens__hub" />
    </>
  );
}

/** The garage workbench: tools on the board, a drill running. */
function WorkshopContents() {
  return (
    <>
      <rect x="82" y="214" width="40" height="16" rx="1.5" className="yd-lens__board" />
      <path d="M88,218 V226 M86,218 H91 M98,217 L108,227 M96,219 L100,215" className="yd-lens__tool" />
      <path d="M114,217 C117,217 118,220 116,222 L113,226" className="yd-lens__tool" />
      <rect x="80" y="240" width="46" height="4" className="yd-lens__bench" />
      <path d="M84,244 V256 M122,244 V256" className="yd-lens__bench-legs" />
      <rect x="94" y="232" width="16" height="7" rx="2" className="yd-lens__drill" />
      <rect x="108" y="234" width="6" height="3" className="yd-lens__chuck" />
      <g className="yd-lens__spin yd-lens__spin--fast" style={{ transformOrigin: "117px 235.5px" }}>
        <path d="M114,235.5 H120" className="yd-lens__bit" />
      </g>
      <circle cx="118" cy="238" r="1" className="yd-lens__dust" />
      <circle cx="118" cy="238" r=".8" className="yd-lens__dust" style={{ animationDelay: ".5s" }} />
      <rect x="98" y="238" width="5" height="4" className="yd-lens__drill-grip" />
    </>
  );
}

export function HouseLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: HouseIds;
  onSelect?: () => void;
}) {
  const part = reading.part as HousePart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<HousePart, ReactNode> = {
    roof: <RoofContents />,
    door: <DoorContents />,
    net: <NetContents />,
    power: <PowerContents reading={reading} />,
    water: <WaterContents />,
    workshop: <WorkshopContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={part === "roof" ? ROOF_PATH : HOUSE_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
