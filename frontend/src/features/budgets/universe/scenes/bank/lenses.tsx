import type { ReactNode } from "react";

import type { BankPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { BankIds } from "./defs";
import { BANK_OUTLINE, CASSETTE, LENSES, NOTES } from "./geometry";

const SWEEP_SECONDS: Record<BankPart, number> = { cassette: 2.6, statement: 2.2, vault: 2.4 };

const round = (value: number) => Number(value.toFixed(2));

/**
 * Inside the cash machine: the bank's gauge. The notes stacked in the
 * cassette are the share of the card budget (or of its monthly mean) still
 * unspent; the card waits in its reader and the rollers turn, the stack
 * resting on the true height. No level at all, and the cassette is empty.
 */
function CassetteContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const share = level === null ? 0 : Math.max(0, Math.min(1, level.share));
  const height = round(share * (NOTES.bottom - NOTES.top));
  const top = round(NOTES.bottom - height);
  const edges: string[] = [];
  for (let y = NOTES.bottom - 1; y > top; y -= 2) edges.push(`M68,${y} H114`);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <rect x="98" y="148" width="28" height="12" rx="2" className="yd-lens__card-reader" />
      <rect x="102" y="151" width="20" height="6" rx="1" className="yd-lens__card" />
      <rect x="105" y="152.5" width="4" height="3" rx=".5" className="yd-lens__card-chip" />
      <g className="yd-lens__roller">
        <circle cx="72" cy="158" r="5" className="yd-lens__roller-rim" />
        <path d="M72,153 V163 M67,158 H77" className="yd-lens__roller-rim" />
      </g>
      <g className="yd-lens__roller yd-lens__roller--reverse">
        <circle cx="85" cy="158" r="5" className="yd-lens__roller-rim" />
        <path d="M85,153 V163 M80,158 H90" className="yd-lens__roller-rim" />
      </g>
      <rect x={CASSETTE.x} y={CASSETTE.y} width={CASSETTE.width} height={CASSETTE.height} rx="2" className="yd-lens__cassette" />
      <rect x="68" y={top} width="46" height={height} className="yd-lens__notes" data-notes="true" />
      {edges.length > 0 ? <path d={edges.join(" ")} className="yd-lens__note-edges" /> : null}
      <rect x="63" y="169" width="56" height="32" rx="3" className={`yd-lens__pack yd-lens__state--${tone}`} />
    </>
  );
}

/** The statement on the counter's tray: the fee line, and the stamp coming down. */
function StatementContents() {
  return (
    <>
      <rect x="292" y="158" width="26" height="36" rx="1" className="yd-lens__sheet" />
      <path d="M296,164 H314 M296,169 H310 M296,174 H313 M296,184 H312 M296,189 H308" className="yd-lens__sheet-lines" />
      <rect x="294" y="177" width="22" height="4" className="yd-lens__fee-line" />
      <circle cx="311" cy="188" r="3.2" className="yd-lens__ink" />
      <g className="yd-lens__stamp">
        <rect x="307" y="156" width="8" height="4" rx="1" className="yd-lens__stamp-foot" />
        <path d="M311,156 V150" className="yd-lens__stamp-handle" />
        <circle cx="311" cy="149" r="2" className="yd-lens__stamp-knob" />
      </g>
    </>
  );
}

/** The vault's door from inside: the bolts, the combination dial, the coins. */
function VaultContents() {
  return (
    <>
      <path
        d="M540,160 L540,136 M540,160 L557,143 M540,160 L564,160 M540,160 L557,177 M540,160 L540,184 M540,160 L523,177 M540,160 L516,160 M540,160 L523,143"
        className="yd-lens__bolts"
      />
      <g className="yd-lens__dial">
        <circle cx="540" cy="160" r="10" className="yd-lens__dial-face" />
        <circle cx="540" cy="160" r="8" className="yd-lens__dial-ticks" />
        <path d="M540,160 V152" className="yd-lens__dial-pointer" />
      </g>
      <g className="yd-lens__coins">
        <ellipse cx="524" cy="180" rx="5" ry="1.6" />
        <ellipse cx="524" cy="177.5" rx="5" ry="1.6" />
        <ellipse cx="524" cy="175" rx="5" ry="1.6" />
        <ellipse cx="556" cy="180" rx="5" ry="1.6" />
        <ellipse cx="556" cy="177.5" rx="5" ry="1.6" />
      </g>
    </>
  );
}

export function BankLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: BankIds;
  onSelect?: () => void;
}) {
  const part = reading.part as BankPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<BankPart, ReactNode> = {
    cassette: <CassetteContents reading={reading} />,
    statement: <StatementContents />,
    vault: <VaultContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={BANK_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
