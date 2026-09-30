/**
 * The house, as numbers: a traditional French pavillon (tiled hip roof,
 * dormer, green shutters, attached garage, low wall with a gate), from the
 * mockup the operator validated on 2026-09-30. Units are the scene's viewBox
 * (640 × 362); y grows downwards, the ground is at y = 262.
 */
import type { HousePart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

export const ROOF_PATH = "M134,156 L232,74 L388,74 L486,156 Z";

/** The house's outline, drawn as a ghost inside the lenses. */
export const HOUSE_OUTLINE = `${ROOF_PATH} M150,160 V262 H470 V160 M58,200 V262 H150 M246,198 V262 M276,198 V262`;

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/** Each lens sits where its part really is in the house. */
export const LENSES: Record<HousePart, LensGeometry> = {
  // The roof frame, under the tiles: what the home insurance covers.
  roof: { cx: 196, cy: 118, r: 26, leader: { from: [196, 92], to: [196, 42] }, align: "above" },
  // The front door's lock and its key: the rent, or the mortgage.
  door: { cx: 266, cy: 236, r: 20, leader: { from: [266, 256], to: [262, 322] }, align: "below" },
  // The box, behind the living-room window.
  net: { cx: 349, cy: 214, r: 20, leader: { from: [352, 194], to: [352, 42] }, align: "above" },
  // The electricity meter, in its box in the low wall.
  power: { cx: 508, cy: 244, r: 22, leader: { from: [512, 222], to: [524, 42] }, align: "above" },
  // The water meter, in its pit in the lawn.
  water: { cx: 452, cy: 296, r: 20, leader: { from: [452, 316], to: [452, 322] }, align: "below" },
  // The garage workbench.
  workshop: { cx: 104, cy: 232, r: 24, leader: { from: [104, 256], to: [104, 322] }, align: "below" },
};

/** How many bars the meter's display has: its level is drawn in fifths. */
export const METER_BARS = 5;
