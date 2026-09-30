import type { ReactNode } from "react";

import type { SalonPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { SalonIds } from "./defs";
import { LENSES, PROGRESS, ROOM_OUTLINE } from "./geometry";

const SWEEP_SECONDS: Record<SalonPart, number> = { tv: 2.6, laptop: 2.2, press: 1.9, gym: 2.8 };

/**
 * The television: a pulsing play button, and a progress bar that is the
 * streaming gauge — filled to the share of its budget (or of its monthly
 * mean) still unspent, the playhead resting where the fill ends. No level:
 * no fill and no playhead.
 */
function TvContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const tone = reading.status ?? "neutral";
  const width = level === null ? 0 : Math.max(0, Math.min(1, level.share)) * PROGRESS.width;
  return (
    <>
      <path d="M322,124 H358 M322,160 H356" className="yd-lens__scan-rows" />
      <circle cx="340" cy="135" r="11" className="yd-lens__play-ring" />
      <path d="M336,129 L346,135 L336,141 Z" className="yd-lens__play" />
      <rect x={PROGRESS.x} y={PROGRESS.y} width={PROGRESS.width} height={PROGRESS.height} rx="2" className="yd-lens__track" />
      {level !== null ? (
        <>
          <rect
            x={PROGRESS.x}
            y={PROGRESS.y}
            width={width}
            height={PROGRESS.height}
            rx="2"
            className={`yd-lens__progress yd-lens__progress--${tone}`}
            data-share={level.share}
          />
          <circle cx={PROGRESS.x + width} cy={PROGRESS.y + PROGRESS.height / 2} r="2.6" className="yd-lens__playhead" />
        </>
      ) : null}
    </>
  );
}

/** The laptop: a cloud, syncing. */
function LaptopContents() {
  return (
    <>
      <path
        d="M540,206 C536,206 534,202 537,199 C537,194 543,192 546,195 C548,190 556,190 558,196 C563,196 566,200 563,204 C562,206 560,206 558,206 Z"
        className="yd-lens__cloud"
      />
      <g className="yd-lens__sync" style={{ transformOrigin: "550px 214px" }}>
        <path d="M544,214 A6,6 0 0 1 556,214 M556,214 L554,211 M556,214 L558.5,211.5" className="yd-lens__sync-arrow" />
        <path d="M556,214 A6,6 0 0 1 544,214" className="yd-lens__sync-arrow yd-lens__sync-arrow--faint" />
      </g>
    </>
  );
}

/** The magazine on the coffee table, a page turning. */
function PressContents() {
  return (
    <>
      <rect x="286" y="296" width="28" height="20" rx="1" className="yd-lens__magazine" />
      <path d="M300,296 V316" className="yd-lens__spine" />
      <path
        d="M289,300 H297 M289,304 H297 M289,308 H296 M303,300 H311 M303,304 H310 M303,308 H311 M303,312 H309"
        className="yd-lens__text"
      />
      <g className="yd-lens__page">
        <path d="M300,296 L313,297 L313,315 L300,316 Z" className="yd-lens__page-sheet" />
      </g>
    </>
  );
}

/** The gym bag: a dumbbell going up and down, a pulse line. */
function GymContents() {
  return (
    <>
      <g className="yd-lens__lift">
        <rect x="82" y="294" width="28" height="4" rx="2" className="yd-lens__handle-bar" />
        <rect x="79" y="289" width="6" height="14" rx="2" className="yd-lens__weight" />
        <rect x="107" y="289" width="6" height="14" rx="2" className="yd-lens__weight" />
      </g>
      <path d="M76,312 H88 L91,306 L95,318 L99,309 L102,312 H116" className="yd-lens__beat" />
    </>
  );
}

export function SalonLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: SalonIds;
  onSelect?: () => void;
}) {
  const part = reading.part as SalonPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<SalonPart, ReactNode> = {
    tv: <TvContents reading={reading} />,
    laptop: <LaptopContents />,
    press: <PressContents />,
    gym: <GymContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={ROOM_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
