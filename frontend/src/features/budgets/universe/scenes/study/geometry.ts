/**
 * The study, as numbers: the bookcase of binders on the left, the bureau
 * with its pigeonholes and drop-front writing flap (the banker's lamp, the
 * hourglass, the tax notice and the adding machine on it), the framed
 * cadastral plan, the metal filing cabinet with its letter tray, the window
 * and the wastepaper basket — from the mockup the operator validated on
 * 2026-10-01. Units are the scene's viewBox (640 × 362); the floor starts at
 * y = 262.
 */
import type { StudyPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const STUDY_OUTLINE =
  "M18,118 H168 V256 H18 Z M176,90 H340 V258 H176 Z M184,176 H332 L338,188 H178 Z " +
  "M352,62 H444 V138 H352 Z M464,152 H536 V256 H464 Z M468,152 V136 H532 V152 M470,138 V124 H530 V138 " +
  "M552,48 H632 V180 H552 Z";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/** Each lens sits where a tax leaves its paper trail. */
export const LENSES: Record<StudyPart, LensGeometry> = {
  hourglass: { cx: 246, cy: 168, r: 26, leader: { from: [246, 142], to: [246, 42] }, align: "above" },
  cadastre: { cx: 398, cy: 100, r: 24, leader: { from: [398, 76], to: [398, 42] }, align: "above" },
  tray: { cx: 500, cy: 140, r: 22, leader: { from: [500, 162], to: [500, 322] }, align: "below" },
  calculator: { cx: 315, cy: 172, r: 20, leader: { from: [315, 192], to: [315, 322] }, align: "below" },
};

/**
 * The hourglass, as the X-ray draws it: its top, its neck and its foot. The
 * sand left in the upper bulb is the share of the income-tax budget (or of
 * its monthly mean) still unspent, measured up from the neck.
 */
export const HOURGLASS = { cx: 246, top: 148, neck: 168, bottom: 188 } as const;

export const UPPER_BULB = "M236,148 C236,160 244,165 246,168 C248,165 256,160 256,148 Z";

export const GLASS =
  "M236,148 C236,160 244,165 246,168 C244,171 236,176 236,188 H256 C256,176 248,171 246,168 C248,165 256,160 256,148 Z";
