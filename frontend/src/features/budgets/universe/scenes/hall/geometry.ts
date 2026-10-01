/**
 * The entrance hall, as numbers: the guitar on its stand, the console with
 * its lamp under the cork board of tickets, the front door, the coat rack and
 * the cabin suitcase, the poster, the bike against the wall — from the mockup
 * the operator validated on 2026-10-01. Units are the scene's viewBox
 * (640 × 362); the floor starts at y = 262.
 */
import type { HallPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const HALL_OUTLINE =
  "M254,58 H366 V262 H254 Z M138,92 H248 V176 H138 Z M140,190 H240 V197 H140 Z " +
  "M148,206 L150,262 M232,206 L230,262 M410,176 H462 V256 H410 Z " +
  "M67,198 A19,16 0 1 0 105,198 A19,16 0 1 0 67,198 Z M60,232 A26,23 0 1 0 112,232 A26,23 0 1 0 60,232 Z " +
  "M552,238 L540,182 M540,188 L592,184 M594,192 L552,238 L508,232 L541,190 M596,198 L606,232";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Each lens sits where the leisure waits by the door. The cork board hangs
 * low enough for the dial's label to leave its lens clear.
 */
export const LENSES: Record<HallPart, LensGeometry> = {
  tickets: { cx: 193, cy: 134, r: 28, leader: { from: [193, 106], to: [193, 42] }, align: "above" },
  suitcase: { cx: 436, cy: 214, r: 26, leader: { from: [436, 188], to: [436, 42] }, align: "above" },
  bike: { cx: 546, cy: 238, r: 22, leader: { from: [546, 260], to: [546, 322] }, align: "below" },
  guitar: { cx: 86, cy: 222, r: 28, leader: { from: [86, 250], to: [86, 322] }, align: "below" },
};

/**
 * The book of eight tickets, two rows of four. As many are left as eighths of
 * the outings budget (or of their monthly mean) still unspent; the torn-out
 * ones stay drawn as dashed stubs, so an empty book reads as empty and not as
 * missing.
 */
export const TICKETS: ReadonlyArray<{ x: number; y: number }> = [121, 135].flatMap((y) =>
  [170.5, 182.5, 194.5, 206.5].map((x) => ({ x, y })),
);

/** A ticket 9 units square, notched on both sides at mid-height. */
export function ticketPath(x: number, y: number): string {
  return `M${x},${y} h9 v3 a1.5,1.5 0 0 0 0,3 v3 h-9 v-3 a1.5,1.5 0 0 0 0,-3 Z`;
}
