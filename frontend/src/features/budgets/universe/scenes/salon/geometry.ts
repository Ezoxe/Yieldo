/**
 * The living room, as numbers: the television wall seen from the sofa's side,
 * the desk with the laptop on the right, the coffee table, the gym bag on the
 * floor — from the mockup the operator validated on 2026-09-30. Units are the
 * scene's viewBox (640 × 362); the floor starts at y = 252.
 */
import type { SalonPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const ROOM_OUTLINE =
  "M250,92 H430 V190 H250 Z M232,224 H448 V254 H232 Z M530,156 L534,128 L572,128 L570,156 Z " +
  "M516,158 H608 M226,296 H390 M66,318 C66,296 78,288 96,288 C114,288 126,296 126,318 Z";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/** Each lens sits on what the subscription is used on. */
export const LENSES: Record<SalonPart, LensGeometry> = {
  tv: { cx: 340, cy: 140, r: 30, leader: { from: [340, 110], to: [340, 42] }, align: "above" },
  laptop: { cx: 552, cy: 206, r: 22, leader: { from: [556, 184], to: [560, 42] }, align: "above" },
  press: { cx: 300, cy: 306, r: 20, leader: { from: [300, 326], to: [300, 330] }, align: "below" },
  gym: { cx: 96, cy: 300, r: 22, leader: { from: [96, 322], to: [96, 330] }, align: "below" },
};

/** The progress bar on the television, inside its lens: the streaming gauge. */
export const PROGRESS = { x: 318, y: 151, width: 44, height: 4 } as const;
