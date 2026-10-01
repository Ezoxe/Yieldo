import type { ReactNode } from "react";

import type { DressingPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { DressingIds } from "./defs";
import { DRESSING_OUTLINE, HANGERS, LENSES, RAIL_Y, garmentPath, hangerPath } from "./geometry";

const SWEEP_SECONDS: Record<DressingPart, number> = { wardrobe: 2.6, tech: 1.9, lamp: 2.1, gifts: 2.4 };

/** A four-pointed star of radius `r`, centred on (cx, cy). */
function sparkle(cx: number, cy: number, r: number): string {
  const i = r / 3;
  return (
    `M${cx},${cy - r} L${cx + i},${cy - i} L${cx + r},${cy} L${cx + i},${cy + i} ` +
    `L${cx},${cy + r} L${cx - i},${cy + i} L${cx - r},${cy} L${cx - i},${cy - i} Z`
  );
}

/**
 * The clothes rail: the dressing room's gauge. As many of its eight hangers
 * are dressed as eighths of the clothing budget (or of its monthly mean)
 * still unspent, and the garments come on one after the other, stopping on
 * the true count. The bare hangers stay as dashed outlines; no level at all,
 * and every hanger is bare.
 */
function WardrobeContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const dressed = level === null ? 0 : Math.round(Math.max(0, Math.min(1, level.share)) * HANGERS.length);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <path d={`M86,${RAIL_Y} H158`} className="yd-lens__rail" />
      {HANGERS.map((hanger, index) =>
        index < dressed ? (
          <g key={index} className="yd-lens__garment" style={{ animationDelay: `${0.15 * index}s` }} data-filled="true">
            <path d={hangerPath(hanger.x)} className="yd-lens__hanger" />
            <path d={garmentPath(hanger.x, hanger.shape)} className={`yd-lens__cloth yd-lens__cloth--${hanger.tone}`} />
          </g>
        ) : (
          <path key={index} d={hangerPath(hanger.x)} className="yd-lens__hanger yd-lens__hanger--bare" />
        ),
      )}
      <rect x="88" y="130" width="68" height="46" rx="4" className={`yd-lens__pack yd-lens__state--${tone}`} />
    </>
  );
}

/** The arc lamp's dome: the socket, the bulb, its filament, the light going down. */
function LampContents() {
  return (
    <>
      <rect x="392" y="97" width="8" height="7" rx="1" className="yd-lens__socket" />
      <circle cx="396" cy="110" r="6" className="yd-lens__bulb-glass" />
      <path d="M393,111 q1.5,-3 3,0 q1.5,3 3,0" className="yd-lens__filament" />
      <path d="M389,118 L383,130 M396,118 V132 M403,118 L409,130" className="yd-lens__rays" />
    </>
  );
}

/** Inside the presents: a ring in its case, the ribbon, sparkles. */
function GiftsContents() {
  return (
    <>
      <path d="M456,210 V254 M434,246 H478" className="yd-lens__ribbon" />
      <rect x="448" y="236" width="16" height="12" rx="1.5" className="yd-lens__jewel-case" />
      <circle cx="456" cy="239" r="3.6" className="yd-lens__jewel" />
      <path d="M456,232.4 L458,234.6 L456,236.4 L454,234.6 Z" className="yd-lens__diamond" />
      <path d={sparkle(443, 227.5, 3.5)} className="yd-lens__sparkle" />
      <path d={sparkle(470, 225.5, 3.5)} className="yd-lens__sparkle" style={{ animationDelay: "0.6s" }} />
      <path d={sparkle(469, 246.8, 2.8)} className="yd-lens__sparkle" style={{ animationDelay: "1.2s" }} />
    </>
  );
}

const TRACES = "M530,160 H542 V170 M532,178 H546 V172 M553,156 V164 H566 M540,186 H560 M553,176 V184";

/** The laptop's board: traces with signals running, the processor, the battery. */
function TechContents() {
  return (
    <>
      <path d={TRACES} className="yd-lens__traces" />
      <path d={TRACES} className="yd-lens__signal" />
      <rect x="543" y="166" width="10" height="10" rx="1" className="yd-lens__processor" />
      <path d="M545,164 V166 M548,164 V166 M551,164 V166 M545,176 V178 M548,176 V178 M551,176 V178" className="yd-lens__pins" />
      <rect x="556" y="176" width="12" height="7" rx="1" className="yd-lens__battery" />
      <rect x="557.5" y="177.5" width="2.5" height="4" className="yd-lens__battery-cell" />
      <rect x="561" y="177.5" width="2.5" height="4" className="yd-lens__battery-cell" />
    </>
  );
}

export function DressingLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: DressingIds;
  onSelect?: () => void;
}) {
  const part = reading.part as DressingPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<DressingPart, ReactNode> = {
    wardrobe: <WardrobeContents reading={reading} />,
    tech: <TechContents />,
    lamp: <LampContents />,
    gifts: <GiftsContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={DRESSING_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
