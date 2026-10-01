/**
 * The child's bedroom, as numbers: the changing table with the baby bottle,
 * the cot under its mobile, the window and its curtains, the dog's basket,
 * the little desk under the chalkboard with the satchel at its foot — from
 * the mockup the operator validated on 2026-10-01. Units are the scene's
 * viewBox (640 × 362); the floor starts at y = 262.
 */
import type { NurseryPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const NURSERY_OUTLINE =
  "M18,170 H176 V256 H18 Z M22,162 H172 M192,150 H368 V258 H192 Z M196,220 H364 " +
  "M380,48 H474 V154 H380 Z M392,254 A38,9 0 1 0 468,254 A38,9 0 1 0 392,254 Z " +
  "M500,70 H610 V136 H500 Z M486,196 H630 V203 H486 Z M492,203 V258 M624,203 V258 M504,218 H542 V258 H504 Z";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Each lens sits where the family spends. The bottle stands far enough from
 * the left edge for its label to stay inside the scene.
 */
export const LENSES: Record<NurseryPart, LensGeometry> = {
  bottle: { cx: 84, cy: 148, r: 26, leader: { from: [84, 174], to: [84, 322] }, align: "below" },
  satchel: { cx: 522, cy: 236, r: 22, leader: { from: [522, 214], to: [522, 42] }, align: "above" },
  basket: { cx: 430, cy: 244, r: 22, leader: { from: [430, 266], to: [430, 322] }, align: "below" },
};

/** The bottle as the X-ray draws it: its body, and the milk's highest and lowest line. */
export const BOTTLE = { x: 75, y: 138, width: 18, height: 31 } as const;

/**
 * The milk left in the bottle is the share of the childcare budget (or of its
 * monthly mean) still unspent, measured up from the bottom.
 */
export const MILK = { top: 139, bottom: 168 } as const;

export const TEAT = "M79,132 Q79,124 84,124 Q89,124 89,132 Z";
