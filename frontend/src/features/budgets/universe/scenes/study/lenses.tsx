import type { ReactNode } from "react";

import type { StudyPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { StudyIds } from "./defs";
import { GLASS, HOURGLASS, LENSES, STUDY_OUTLINE, UPPER_BULB } from "./geometry";

const SWEEP_SECONDS: Record<StudyPart, number> = { hourglass: 2.6, cadastre: 2.3, tray: 2.1, calculator: 1.9 };

const round = (value: number) => Number(value.toFixed(2));

/**
 * The hourglass: the study's gauge. The sand left in the upper bulb is the
 * share of the income-tax budget (or of its monthly mean) still unspent,
 * measured up from the neck; the fallen pile below is the rest, and a thin
 * stream runs while there is sand left. No level at all, and the hourglass
 * is empty — no sand above, none below.
 */
function HourglassContents({ reading, clipId }: { reading: PartReading; clipId: string }) {
  const { level } = reading;
  const share = level === null ? 0 : Math.max(0, Math.min(1, level.share));
  const sand = round(share * (HOURGLASS.neck - HOURGLASS.top));
  const pile = level === null ? 0 : round((1 - share) * 9);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <path d="M234,145 H258 M234,191 H258 M235,145 V191 M257,145 V191" className="yd-lens__hourglass-frame" />
      <path d={GLASS} className="yd-lens__glass" />
      <clipPath id={clipId}>
        <path d={UPPER_BULB} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="234" y={round(HOURGLASS.neck - sand)} width="24" height={sand} className="yd-lens__sand" data-sand="true" />
      </g>
      {pile > 0 ? (
        <path
          d={`M240,${HOURGLASS.bottom} Q${HOURGLASS.cx},${round(HOURGLASS.bottom - 2 * pile)} 252,${HOURGLASS.bottom} Z`}
          className="yd-lens__sand yd-lens__sand--fallen"
        />
      ) : null}
      {sand > 0 ? <path d={`M${HOURGLASS.cx},${HOURGLASS.neck} V${HOURGLASS.bottom - 2}`} className="yd-lens__stream" /> : null}
      <rect x="232" y="144" width="28" height="48" rx="3" className={`yd-lens__pack yd-lens__state--${tone}`} />
    </>
  );
}

/** The cadastral plan: the parcels, the household's own outlined, its house. */
function CadastreContents() {
  return (
    <>
      <path
        d="M356,88 L386,82 L404,96 L440,90 M386,82 L382,134 M404,96 L410,134 M356,112 L382,108 M410,112 L440,116 M420,66 L414,93"
        className="yd-lens__parcels"
      />
      <path d="M386,82 L404,96 L410,112 L384,114 Z" className="yd-lens__parcel" />
      <path d="M386,82 L404,96 L410,112 L384,114 Z" className="yd-lens__parcel-edge" />
      <path d="M392,104 L396,99 L400,104 V109 H392 Z" className="yd-lens__house" />
    </>
  );
}

/** The letter tray: notices in their window envelopes, one more coming in. */
function TrayContents() {
  return (
    <>
      <rect x="478" y="140" width="40" height="9" rx="1" className="yd-lens__envelope" />
      <rect x="482" y="142" width="12" height="4" className="yd-lens__envelope-window" />
      <g className="yd-lens__letter">
        <rect x="480" y="128" width="40" height="9" rx="1" className="yd-lens__envelope yd-lens__envelope--new" />
        <rect x="484" y="130" width="12" height="4" className="yd-lens__envelope-window" />
        <circle cx="514" cy="132.5" r="2.2" className="yd-lens__seal" />
      </g>
    </>
  );
}

/** The adding machine: its keys, and the paper tape printing as it rolls. */
function CalculatorContents() {
  return (
    <>
      <path d="M300,184 L304,168 H326 L330,184 Z" className="yd-lens__machine" />
      {[174, 179].flatMap((y, row) =>
        [308, 313, 318, 323].map((x) => (
          <circle key={`${x}-${y}`} cx={x - row} cy={y} r=".9" className="yd-lens__keypad" />
        )),
      )}
      <rect x="311" y="150" width="8" height="18" className="yd-lens__tape" />
      <path d="M313,153 H317 M313,156 H316 M313,159 H317 M313,162 H315 M313,165 H317" className="yd-lens__tape-lines" />
      <circle cx="315" cy="167" r="3" className="yd-lens__roll" />
    </>
  );
}

export function StudyLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: StudyIds;
  onSelect?: () => void;
}) {
  const part = reading.part as StudyPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<StudyPart, ReactNode> = {
    hourglass: <HourglassContents reading={reading} clipId={ids.lens("bulb")} />,
    cadastre: <CadastreContents />,
    tray: <TrayContents />,
    calculator: <CalculatorContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={STUDY_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
