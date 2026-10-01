/**
 * The doctor's office, as numbers: the medicine cabinet over the washbasin on
 * the left, the desk under the window with its lamp, stethoscope, screen and
 * card reader, the white coat, the eye chart over the glasses shelf, the
 * examination table — from the mockup the operator validated on 2026-10-01.
 * Units are the scene's viewBox (640 × 362); the floor starts at y = 262.
 */
import type { ClinicPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const CLINIC_OUTLINE =
  "M34,100 H138 V214 H34 Z M184,198 H424 L432,212 H176 Z M182,219 V300 M426,219 V300 " +
  "M268,148 H332 V192 H268 Z M330,206 V172 Q330,160 342,160 H360 Q372,160 372,172 V206 " +
  "M556,46 H612 V150 H556 Z M452,228 H628 V243 H452 Z";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Each lens sits where the care is paid for. The cabinet hangs low enough for
 * the dial's label to leave its green cross in sight, and the glasses' leader
 * leaves the lens left of centre so their label stays inside the scene.
 */
export const LENSES: Record<ClinicPart, LensGeometry> = {
  medicine: { cx: 86, cy: 162, r: 34, leader: { from: [86, 196], to: [86, 322] }, align: "below" },
  stethoscope: { cx: 226, cy: 204, r: 22, leader: { from: [226, 182], to: [226, 42] }, align: "above" },
  reader: { cx: 381, cy: 194, r: 20, leader: { from: [381, 174], to: [381, 42] }, align: "above" },
  glasses: { cx: 584, cy: 160, r: 24, leader: { from: [566, 176], to: [566, 322] }, align: "below" },
};

/**
 * The blister's ten pills, two rows of five. As many are left as tenths of the
 * pharmacy budget (or of its monthly mean) still unspent; the pushed-out ones
 * stay drawn as empty cells, so an empty blister reads as empty and not as
 * missing.
 */
export const BLISTER_PILLS: ReadonlyArray<{ x: number; y: number }> = [158, 170].flatMap((y) =>
  [67, 76.5, 86, 95.5, 105].map((x) => ({ x, y })),
);
