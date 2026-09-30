/**
 * The kitchen, as numbers: the steel fridge on the left, the counter with the
 * delivery box and the espresso machine, the window, the laid table — from
 * the mockup the operator validated on 2026-09-30. Units are the scene's
 * viewBox (640 × 362); the floor starts at y = 262.
 */
import type { KitchenPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const KITCHEN_OUTLINE =
  "M36,64 H144 V262 H36 Z M36,138 H144 M150,202 H480 V262 H150 Z M364,150 H402 V196 H364 Z " +
  "M202,182 H250 V194 H202 Z M440,276 H630";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/** Each lens sits where the food is bought, delivered, brewed or served. */
export const LENSES: Record<KitchenPart, LensGeometry> = {
  fridge: { cx: 90, cy: 160, r: 34, leader: { from: [90, 194], to: [90, 322] }, align: "below" },
  delivery: { cx: 226, cy: 190, r: 20, leader: { from: [226, 170], to: [226, 42] }, align: "above" },
  coffee: { cx: 382, cy: 176, r: 20, leader: { from: [382, 156], to: [382, 42] }, align: "above" },
  plate: { cx: 530, cy: 282, r: 22, leader: { from: [530, 304], to: [530, 322] }, align: "below" },
};

export type FridgeItemShape = "bottle" | "apple" | "carton" | "jar";

/**
 * The fridge's twelve places, three shelves of four. As many are filled as
 * twelfths of the groceries budget (or of their monthly mean) still unspent;
 * the empty ones stay drawn as dashed outlines, so an empty fridge reads as
 * empty and not as missing.
 */
export const FRIDGE_SLOTS: Array<{ x: number; y: number; shape: FridgeItemShape }> = [
  { x: 64, y: 130, shape: "bottle" },
  { x: 78, y: 132, shape: "apple" },
  { x: 90, y: 130, shape: "carton" },
  { x: 104, y: 131, shape: "jar" },
  { x: 64, y: 150, shape: "jar" },
  { x: 78, y: 152, shape: "apple" },
  { x: 90, y: 150, shape: "bottle" },
  { x: 104, y: 150, shape: "carton" },
  { x: 64, y: 170, shape: "carton" },
  { x: 78, y: 171, shape: "jar" },
  { x: 92, y: 172, shape: "apple" },
  { x: 104, y: 170, shape: "bottle" },
];
