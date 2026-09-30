import type { ReactNode } from "react";

import type { KitchenPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { KitchenIds } from "./defs";
import { FRIDGE_SLOTS, KITCHEN_OUTLINE, LENSES, type FridgeItemShape } from "./geometry";

const SWEEP_SECONDS: Record<KitchenPart, number> = { fridge: 2.6, delivery: 2.1, coffee: 1.9, plate: 2.8 };

function FridgeItem({ x, y, shape, delay }: { x: number; y: number; shape: FridgeItemShape; delay: number }) {
  const style = { animationDelay: `${delay}s` };
  switch (shape) {
    case "bottle":
      return <rect x={x} y={y} width="6" height="11" rx="2" className="yd-lens__item yd-lens__item--bottle" style={style} data-filled="true" />;
    case "apple":
      return <circle cx={x + 4} cy={y + 5} r="4" className="yd-lens__item yd-lens__item--apple" style={style} data-filled="true" />;
    case "carton":
      return <rect x={x} y={y} width="8" height="11" rx="1" className="yd-lens__item yd-lens__item--carton" style={style} data-filled="true" />;
    case "jar":
      return <rect x={x} y={y + 2} width="9" height="9" rx="2" className="yd-lens__item yd-lens__item--jar" style={style} data-filled="true" />;
  }
}

/**
 * The fridge: the kitchen's gauge. As many of its twelve places are filled as
 * twelfths of the groceries budget (or of their monthly mean) still unspent,
 * and the items come in one after the other, stopping on the true count. The
 * empty places stay as dashed outlines; no level at all, and every place is
 * an outline.
 */
function FridgeContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const filled = level === null ? 0 : Math.round(Math.max(0, Math.min(1, level.share)) * FRIDGE_SLOTS.length);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <path d="M60,140 H120 M60,160 H120 M60,180 H120" className="yd-lens__shelf" />
      {FRIDGE_SLOTS.map((slot, index) =>
        index < filled ? (
          <FridgeItem key={index} x={slot.x} y={slot.y} shape={slot.shape} delay={0.15 * index} />
        ) : (
          <rect key={index} x={slot.x} y={slot.y + 1} width="9" height="9" rx="2" className="yd-lens__slot" />
        ),
      )}
      <rect x="58" y="126" width="64" height="58" rx="4" className={`yd-lens__fridge yd-lens__state--${tone}`} />
    </>
  );
}

/** The delivery box: the dish inside, the rider, the clock. */
function DeliveryContents() {
  return (
    <>
      <rect x="210" y="186" width="32" height="10" rx="1.5" className="yd-lens__box" />
      <circle cx="226" cy="191" r="4" className="yd-lens__pizza" />
      <circle cx="224" cy="190" r=".9" className="yd-lens__topping" />
      <circle cx="228" cy="192" r=".9" className="yd-lens__topping" />
      <g className="yd-lens__rider">
        <path d="M212,180 H220 M216,176 V184" className="yd-lens__rider-frame" />
        <circle cx="213" cy="183" r="1.6" className="yd-lens__wheel" />
        <circle cx="220" cy="183" r="1.6" className="yd-lens__wheel" />
      </g>
      <path d="M230,176 A6,6 0 1 1 236.5,182 M236,176 V179 H238" className="yd-lens__clock" />
    </>
  );
}

/** The espresso machine: coffee running into the cup. */
function CoffeeContents() {
  return (
    <>
      <rect x="372" y="162" width="20" height="6" rx="1.5" className="yd-lens__group" />
      <rect x="381" y="170" width="2" height="4" rx="1" className="yd-lens__drip" />
      <path d="M374,178 H390 L388,190 Q382,193 376,190 Z" className="yd-lens__cup" />
      <g className="yd-lens__coffee">
        <path d="M375,182 H389 L388,189 Q382,191 376,189 Z" className="yd-lens__coffee-fill" />
      </g>
      <path d="M390,181 C394,181 394,187 389,187" className="yd-lens__cup-handle" />
    </>
  );
}

/** The plate on the table: the dish, the cutlery, the steam. */
function PlateContents() {
  return (
    <>
      <ellipse cx="530" cy="284" rx="15" ry="6" className="yd-lens__plate" />
      <ellipse cx="530" cy="283" rx="9" ry="3" className="yd-lens__dish" />
      <path d="M511,278 V292 M510,278 V282 M512,278 V282 M549,278 V292 M549,278 Q553,282 549,285" className="yd-lens__cutlery" />
      <path d="M526,276 q-2,-3 0,-6 q2,-3 0,-6" className="yd-lens__vapour" />
      <path d="M534,276 q-2,-3 0,-6 q2,-3 0,-6" className="yd-lens__vapour" style={{ animationDelay: "1s" }} />
    </>
  );
}

export function KitchenLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: KitchenIds;
  onSelect?: () => void;
}) {
  const part = reading.part as KitchenPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<KitchenPart, ReactNode> = {
    fridge: <FridgeContents reading={reading} />,
    delivery: <DeliveryContents />,
    coffee: <CoffeeContents />,
    plate: <PlateContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={KITCHEN_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
