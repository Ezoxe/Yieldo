import type { ReactNode } from "react";

import type { HallPart } from "../../registry";
import type { PartReading } from "../../readings";
import { LensFrame, lensState } from "../shared/LensFrame";
import type { HallIds } from "./defs";
import { HALL_OUTLINE, LENSES, TICKETS, ticketPath } from "./geometry";

const SWEEP_SECONDS: Record<HallPart, number> = { tickets: 2.6, suitcase: 2.3, bike: 2, guitar: 2.8 };

/** The bottom bracket the crank turns around. */
const CRANK = { x: 552, y: 238 } as const;

/** A four-pointed star of radius `r`, centred on (cx, cy). */
function star(cx: number, cy: number, r: number): string {
  const i = r / 4;
  return (
    `M${cx},${cy - r} L${cx + i},${cy - i} L${cx + r},${cy} L${cx + i},${cy + i} ` +
    `L${cx},${cy + r} L${cx - i},${cy + i} L${cx - r},${cy} L${cx - i},${cy - i} Z`
  );
}

/**
 * The tickets pinned on the cork board: the hall's gauge. As many of the
 * book's eight tickets are left as eighths of the outings budget (or of their
 * monthly mean) still unspent, and they come in one after the other, stopping
 * on the true count. The torn-out ones stay as dashed stubs; no level at all,
 * and every ticket is a stub.
 */
function TicketsContents({ reading }: { reading: PartReading }) {
  const { level } = reading;
  const left = level === null ? 0 : Math.round(Math.max(0, Math.min(1, level.share)) * TICKETS.length);
  const tone = reading.status ?? "neutral";
  return (
    <>
      <path d={star(178, 115, 4)} className="yd-lens__star" />
      <path d={star(209, 113.5, 3.5)} className="yd-lens__star" style={{ animationDelay: "0.9s" }} />
      {TICKETS.map((ticket, index) =>
        index < left ? (
          <path
            key={index}
            d={ticketPath(ticket.x, ticket.y)}
            className="yd-lens__ticket"
            style={{ animationDelay: `${0.15 * index}s` }}
            data-filled="true"
          />
        ) : (
          <path key={index} d={ticketPath(ticket.x, ticket.y)} className="yd-lens__stub" />
        ),
      )}
      <rect x="167" y="118" width="52" height="29" rx="3" className={`yd-lens__pack yd-lens__state--${tone}`} />
      <rect x="168" y="150" width="50" height="7" className="yd-lens__film" />
      <path d="M168,151.6 H218 M168,155.4 H218" className="yd-lens__film-holes" />
    </>
  );
}

/** The suitcase, packed: clothes, sunglasses, a passport, a plane on its way. */
function SuitcaseContents() {
  return (
    <>
      <path d="M414,204 Q436,188 458,204" className="yd-lens__flight" />
      {/* At rest at the top of its arc; the flight runs from one end to the other. */}
      <g transform="translate(436 196)">
        <path d="M-4,0 H4 M0,-3.2 L1.4,0 L0,3.2 M-3.4,-1.6 L-2.6,0 L-3.4,1.6" className="yd-lens__plane" />
      </g>
      <circle cx="422" cy="214" r="3" className="yd-lens__sunglasses" />
      <circle cx="430" cy="214" r="3" className="yd-lens__sunglasses" />
      <path d="M425,213.5 H427" className="yd-lens__sunglasses" />
      <rect x="442" y="207" width="10" height="13" rx="1" className="yd-lens__passport" />
      <circle cx="447" cy="212" r="2" className="yd-lens__passport-emblem" />
      <rect x="418" y="222" width="36" height="5" rx="1" className="yd-lens__clothes yd-lens__clothes--blue" />
      <rect x="418" y="227.5" width="36" height="5" rx="1" className="yd-lens__clothes yd-lens__clothes--lilac" />
      <rect x="418" y="233" width="36" height="5" rx="1" className="yd-lens__clothes yd-lens__clothes--sand" />
    </>
  );
}

/** The bike's drivetrain: the chainring, the chain running, the crank turning. */
function BikeContents() {
  return (
    <>
      <path d="M552,229 L508,228 M552,247 L508,236" className="yd-lens__chain" />
      <circle cx={CRANK.x} cy={CRANK.y} r="10" className="yd-lens__teeth" />
      <circle cx={CRANK.x} cy={CRANK.y} r="8.4" className="yd-lens__chainring" />
      <circle cx={CRANK.x} cy={CRANK.y} r="3" className="yd-lens__axle" />
      <g className="yd-lens__crank" style={{ transformOrigin: `${CRANK.x}px ${CRANK.y}px` }}>
        <path d={`M${CRANK.x},${CRANK.y} L${CRANK.x},${CRANK.y + 15}`} className="yd-lens__crank-arm" />
        <rect x={CRANK.x - 4} y={CRANK.y + 14} width="8" height="3" rx="1" className="yd-lens__pedal" />
      </g>
    </>
  );
}

/** Inside the guitar: the bracing, the soundhole, strings ringing, notes rising. */
function GuitarContents() {
  return (
    <>
      <path d="M68,212 L104,248 M104,212 L68,248" className="yd-lens__bracing" />
      <circle cx="86" cy="204" r="6.5" className="yd-lens__soundhole" />
      <circle cx="86" cy="204" r="8.5" className="yd-lens__rosette" />
      {[81, 83, 85, 87, 89, 91].map((x, index) => (
        <path
          key={x}
          d={`M${x},194 V238`}
          className={index % 2 === 0 ? "yd-lens__string yd-lens__string--ringing" : "yd-lens__string"}
          style={index % 2 === 0 ? { animationDelay: `${0.03 * index}s` } : undefined}
        />
      ))}
      <rect x="76" y="236" width="20" height="4" rx="1" className="yd-lens__bridge" />
      <g className="yd-lens__note">
        <circle cx="101" cy="214" r="2" className="yd-lens__note-head" />
        <path d="M102.6,214 V206 L106,205" className="yd-lens__note-stem" />
      </g>
      <g className="yd-lens__note" style={{ animationDelay: "1.3s" }}>
        <circle cx="70" cy="208" r="1.8" className="yd-lens__note-head" />
        <path d="M71.5,208 V201" className="yd-lens__note-stem" />
      </g>
    </>
  );
}

export function HallLens({
  reading,
  ids,
  onSelect,
}: {
  reading: PartReading;
  ids: HallIds;
  onSelect?: () => void;
}) {
  const part = reading.part as HallPart;
  const { cx, cy, r } = LENSES[part];
  const contents: Record<HallPart, ReactNode> = {
    tickets: <TicketsContents reading={reading} />,
    suitcase: <SuitcaseContents />,
    bike: <BikeContents />,
    guitar: <GuitarContents />,
  };
  return (
    <LensFrame
      part={part}
      cx={cx}
      cy={cy}
      r={r}
      ids={ids}
      state={lensState(reading)}
      ghost={<path d={HALL_OUTLINE} className="yd-lens__ghost" />}
      sweepSeconds={SWEEP_SECONDS[part]}
      onSelect={onSelect}
    >
      {contents[part]}
    </LensFrame>
  );
}
