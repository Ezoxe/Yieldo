import type { ReactNode } from "react";

import type { NurseryPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { NurseryIds } from "./defs";
import { BOTTLE, LENSES, MILK, NURSERY_OUTLINE, TEAT } from "./geometry";

const SWEEP_SECONDS: Record<NurseryPart, number> = { bottle: 2.6, satchel: 2.2, basket: 2.4 };

const round = (value: number) => Number(value.toFixed(2));

/**
 * The baby bottle: the nursery's gauge. The milk left in it is the share of
 * the childcare budget (or of its monthly mean) still unspent, read against
 * the bottle's own graduations; its surface ripples and a few bubbles rise,
 * resting on the true level. No level at all, and the bottle is empty.
 */
function BottleContents({ reading, clipId }: { reading: PartReading; clipId: string }) {
  const { level } = reading;
  const share = level === null ? 0 : Math.max(0, Math.min(1, level.share));
  const milk = round(share * (MILK.bottom - MILK.top));
  const top = round(MILK.bottom - milk);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <path d={TEAT} className="yd-lens__teat" />
      <rect x="76" y="132" width="16" height="6" rx="1.5" className="yd-lens__collar" />
      <rect x={BOTTLE.x} y={BOTTLE.y} width={BOTTLE.width} height={BOTTLE.height} rx="4" className="yd-lens__bottle-body" />
      <clipPath id={clipId}>
        <rect x={BOTTLE.x} y={BOTTLE.y} width={BOTTLE.width} height={BOTTLE.height} rx="4" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="69" y={top} width="30" height={milk} className="yd-lens__milk" data-milk="true" />
        {milk > 0 ? (
          <path d={`M69,${top} q3,-2 6,0 t6,0 t6,0 t6,0 t6,0 t6,0 V${round(top + 3)} H69 Z`} className="yd-lens__milk-wave" />
        ) : null}
        {milk > 4 ? (
          <>
            <circle cx="80" cy="166" r="1" className="yd-lens__bubble" />
            <circle cx="87" cy="167" r=".8" className="yd-lens__bubble" style={{ animationDelay: "1.1s" }} />
          </>
        ) : null}
      </g>
      <path d="M88,144 H92 M88,150 H92 M88,156 H92 M88,162 H92" className="yd-lens__graduations" />
      <rect x="70" y="122" width="28" height="50" rx="4" className={`yd-lens__pack yd-lens__state--${tone}`} />
    </>
  );
}

/** The satchel: two exercise books, the pencil case, a ruler, a good-work star. */
function SatchelContents() {
  return (
    <>
      <rect x="508" y="222" width="12" height="20" rx="1" className="yd-lens__notebook" />
      <rect x="511" y="224" width="12" height="20" rx="1" className="yd-lens__notebook yd-lens__notebook--lilac" />
      <rect x="526" y="230" width="12" height="5" rx="2.5" className="yd-lens__pencil-case" />
      <path d="M528,232.5 H536" className="yd-lens__pencil-leads" />
      <rect x="507" y="246" width="30" height="4" className="yd-lens__ruler" />
      <path d="M511,246 V248 M515,246 V249 M519,246 V248 M523,246 V249 M527,246 V248 M531,246 V249" className="yd-lens__ruler-ticks" />
      <path
        d="M532,220 l1.2,2.4 l2.6,.4 l-1.9,1.8 l.4,2.6 l-2.3,-1.2 l-2.3,1.2 l.4,-2.6 l-1.9,-1.8 l2.6,-.4 Z"
        className="yd-lens__good-work"
      />
    </>
  );
}

/** The dog asleep in its basket: breathing, its ribs, its bone, its snores. */
function BasketContents() {
  return (
    <>
      <g className="yd-lens__dog-body">
        <path d="M412,250 C412,238 424,234 436,236 C448,238 452,244 450,250 Z" className="yd-lens__dog" />
      </g>
      <path d="M420,246 Q424,240 428,246 M426,245 Q430,239 434,245 M432,246 Q436,240 440,246" className="yd-lens__ribs" />
      <path d="M444,240 C448,236 456,238 454,244 C452,248 446,248 444,246 Z" className="yd-lens__dog" />
      <path d="M450,240 L454,234 L456,242" className="yd-lens__dog-ear" />
      <path d="M413,249 C407,247 405,241 411,241" className="yd-lens__dog-ear" />
      <path
        d="M418,256 h10 M418,256 a1.6,1.6 0 1 1 0,-2 M418,256 a1.6,1.6 0 1 0 0,2 M428,256 a1.6,1.6 0 1 0 0,-2 M428,256 a1.6,1.6 0 1 1 0,2"
        className="yd-lens__bone"
      />
      <path d="M444,228 h4 l-4,4 h4" className="yd-lens__snore" />
      <path d="M447,224 h3 l-3,3 h3" className="yd-lens__snore" style={{ animationDelay: "1.5s" }} />
    </>
  );
}

export function NurseryLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: NurseryIds;
  onSelect?: () => void;
}) {
  const part = reading.part as NurseryPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<NurseryPart, ReactNode> = {
    bottle: <BottleContents reading={reading} clipId={ids.lens("milk")} />,
    satchel: <SatchelContents />,
    basket: <BasketContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={NURSERY_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
