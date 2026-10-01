/**
 * The bank's lobby, as numbers: the cash machine in its recess on the left,
 * the counter and its glass partition with the tray in the middle, the round
 * vault door on the right — from the mockup the operator validated on
 * 2026-10-01. Units are the scene's viewBox (640 × 362); the floor starts at
 * y = 262.
 */
import type { BankPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const BANK_OUTLINE =
  "M40,118 H140 V250 H40 Z M56,128 H124 V160 H56 Z M200,88 H420 V180 H200 Z M192,180 H428 " +
  "M196,188 H424 V256 H196 Z M540,90 A70,70 0 1 0 540,230 A70,70 0 1 0 540,90 Z M466,70 H614 V252 H466 Z";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/** Each lens sits where a fee is charged. */
export const LENSES: Record<BankPart, LensGeometry> = {
  cassette: { cx: 90, cy: 170, r: 30, leader: { from: [90, 200], to: [90, 322] }, align: "below" },
  statement: { cx: 306, cy: 176, r: 24, leader: { from: [306, 152], to: [306, 42] }, align: "above" },
  vault: { cx: 540, cy: 160, r: 26, leader: { from: [540, 186], to: [540, 322] }, align: "below" },
};

/** The cash machine's note cassette, as the X-ray draws it. */
export const CASSETTE = { x: 66, y: 172, width: 50, height: 26 } as const;

/**
 * The notes left in the cassette are the share of the card budget (or of its
 * monthly mean) still unspent, stacked up from the cassette's floor.
 */
export const NOTES = { top: 174, bottom: 196 } as const;
