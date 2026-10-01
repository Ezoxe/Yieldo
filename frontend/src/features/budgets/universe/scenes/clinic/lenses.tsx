import type { ReactNode } from "react";

import type { ClinicPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { ClinicIds } from "./defs";
import { BLISTER_PILLS, CLINIC_OUTLINE, LENSES } from "./geometry";

const SWEEP_SECONDS: Record<ClinicPart, number> = { medicine: 2.6, stethoscope: 2.1, reader: 1.9, glasses: 2.8 };

/**
 * Inside the medicine cabinet: the office's gauge. As many of the blister's
 * ten pills are left as tenths of the pharmacy budget (or of its monthly
 * mean) still unspent, and they come in one after the other, stopping on the
 * true count. The pushed-out cells stay as dashed outlines; no level at all,
 * and every cell is empty.
 */
function MedicineContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const left = level === null ? 0 : Math.round(Math.max(0, Math.min(1, level.share)) * BLISTER_PILLS.length);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <path d="M54,146 H118 M54,182 H118" className="yd-lens__shelf" />
      <rect x="62" y="135" width="13" height="11" rx="1" className="yd-lens__carton" />
      <path d="M80,146 V138 Q80,134 84,134 H86 Q90,134 90,138 V146 Z M82,134 V131 H88 V134" className="yd-lens__carton" />
      <rect x="94" y="137" width="16" height="9" rx="1" className="yd-lens__carton" />
      <rect x="60" y="151" width="52" height="26" rx="3" className="yd-lens__blister" />
      {BLISTER_PILLS.map((pill, index) =>
        index < left ? (
          <g key={index} className="yd-lens__pill" style={{ animationDelay: `${0.15 * index}s` }} data-filled="true">
            <ellipse cx={pill.x} cy={pill.y} rx="3.6" ry="3.2" className="yd-lens__tablet" />
            <path d={`M${pill.x - 2.4},${pill.y} H${pill.x + 2.4}`} className="yd-lens__score" />
          </g>
        ) : (
          <ellipse key={index} cx={pill.x} cy={pill.y} rx="3.6" ry="3.2" className="yd-lens__cell" />
        ),
      )}
      <rect x="57" y="148" width="58" height="32" rx="4" className={`yd-lens__pack yd-lens__state--${tone}`} />
    </>
  );
}

/** The stethoscope on the desk, and a heartbeat crossing the lens. */
function StethoscopeContents() {
  return (
    <>
      <path d="M204,193 H213 L216,189 L219,197 L222,184 L225,198 L228,191 L231,193 H248" className="yd-lens__ecg" />
      <path d="M212,203 L209,199 M212,203 L216,199 M212,203 Q207,213 215,218 Q224,223 231,216" className="yd-lens__tubing" />
      <circle cx="234" cy="213" r="4.2" className="yd-lens__chestpiece" />
      <circle cx="234" cy="213" r="1.8" className="yd-lens__diaphragm" />
    </>
  );
}

/** The card reader: its keypad, the card in its slot, the screen reading it. */
function ReaderContents() {
  return (
    <>
      <path d="M371,178 H391 L393,200 H369 Z" className="yd-lens__terminal" />
      <rect x="374" y="181" width="14" height="6" rx="1" className="yd-lens__terminal-screen" />
      <path d="M376.5,184 H385.5" className="yd-lens__reading" />
      {[376, 381, 386].flatMap((x) =>
        [191, 195].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r=".9" className="yd-lens__keypad" />),
      )}
      <rect x="373" y="198" width="16" height="11" rx="1.5" className="yd-lens__card" />
      <rect x="376" y="201" width="4.5" height="3.5" rx=".6" className="yd-lens__chip" />
      <path d="M383,202 H387 M383,205 H386" className="yd-lens__card-lines" />
    </>
  );
}

/** The shelf under the eye chart: the glasses, and a tooth down to its roots. */
function GlassesContents() {
  return (
    <>
      <path d="M567.4,136.1 H600.6 M567.8,142 H600.2" className="yd-lens__chart-rows" />
      <path d="M546,170 H622" className="yd-lens__shelf" />
      <circle cx="567" cy="163" r="5.5" className="yd-lens__frames" />
      <circle cx="580" cy="163" r="5.5" className="yd-lens__frames" />
      <path d="M572.5,162 Q573.5,159.5 574.5,162 M561.5,161 L558,158 M585.5,161 L589,158" className="yd-lens__frames" />
      <path d="M563.5,163 A3.5,3.5 0 0 1 567,159.5 M576.5,163 A3.5,3.5 0 0 1 580,159.5" className="yd-lens__refraction" />
      <path d="M566,169 L572,157" className="yd-lens__glint" />
      <path
        d="M592,152 C592,148 595,147 597.5,149 C600,147 603,148 603,152 C603,157 601,158 601,162 L600,166 C599.5,168 598,167 598,165 L597.5,161 L597,165 C597,167 595.5,168 595,166 L594,162 C594,158 592,157 592,152 Z"
        className="yd-lens__tooth"
      />
      <path d="M597.5,151 V159" className="yd-lens__canal" />
    </>
  );
}

export function ClinicLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: ClinicIds;
  onSelect?: () => void;
}) {
  const part = reading.part as ClinicPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<ClinicPart, ReactNode> = {
    medicine: <MedicineContents reading={reading} />,
    stethoscope: <StethoscopeContents />,
    reader: <ReaderContents />,
    glasses: <GlassesContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={CLINIC_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
