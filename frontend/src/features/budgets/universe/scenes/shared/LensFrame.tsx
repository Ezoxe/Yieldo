import type { CSSProperties, ReactNode } from "react";

import "./scene.css";

export type LensState = "plain" | "focused" | "dimmed";

export function lensState(reading: { focused: boolean; dimmed: boolean }): LensState {
  if (reading.focused) return "focused";
  return reading.dimmed ? "dimmed" : "plain";
}

/** The ids a lens needs from its scene's <defs>: the scan lines and the vignette. */
export interface LensDefIds {
  lines: string;
  vignette: string;
  lens: (name: string) => string;
}

/** The pattern and gradient every lens paints with; a scene puts them in its <defs>. */
export function LensDefs({ ids }: { ids: LensDefIds }) {
  return (
    <>
      <radialGradient id={ids.vignette}>
        <stop offset={0.55} className="yd-lens__vignette-0" />
        <stop offset={1} className="yd-lens__vignette-1" />
      </radialGradient>
      <pattern id={ids.lines} width="4" height="3" patternUnits="userSpaceOnUse">
        <path d="M0,.5 H4" className="yd-lens__scanline" />
      </pattern>
    </>
  );
}

interface LensFrameProps {
  part: string;
  cx: number;
  cy: number;
  r: number;
  ids: LensDefIds;
  state: LensState;
  /** The scene's outline, drawn as a ghost inside the lens. */
  ghost: ReactNode;
  sweepSeconds: number;
  onSelect?: () => void;
  children: ReactNode;
}

/**
 * A round window where the drawing turns to X-ray: the navy screen, the scan
 * lines, the scene's outline as a ghost, the part itself, a sweep, a vignette
 * and the reticle around it. Pointer shortcut only — the part's label is the
 * accessible way to the same page.
 */
export function LensFrame({ part, cx, cy, r, ids, state, ghost, sweepSeconds, onSelect, children }: LensFrameProps) {
  const clip = ids.lens(part);
  const sweep = { "--d": `${2 * r - 2}px`, animationDuration: `${sweepSeconds}s` } as CSSProperties;
  return (
    <g
      className={`yd-lens yd-lens--${part} yd-lens--${state}`}
      onClick={onSelect}
      data-selectable={onSelect ? "true" : undefined}
    >
      <clipPath id={clip}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <circle cx={cx} cy={cy} r={r} className="yd-lens__base" />
        <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={`url(#${ids.lines})`} />
        {ghost}
        {children}
        <rect className="yd-lens__sweep" x={cx - r} y={cy - r} width={2 * r} height={1.5} style={sweep} />
        <circle cx={cx} cy={cy} r={r} fill={`url(#${ids.vignette})`} />
      </g>
      <circle cx={cx} cy={cy} r={r} className="yd-lens__ring" />
      <circle
        cx={cx}
        cy={cy}
        r={r + 4}
        className="yd-lens__orbit"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <path
        d={`M${cx},${cy - r - 4} V${cy - r} M${cx},${cy + r} V${cy + r + 4} M${cx - r - 4},${cy} H${cx - r} M${cx + r},${cy} H${cx + r + 4}`}
        className="yd-lens__ticks"
      />
    </g>
  );
}
