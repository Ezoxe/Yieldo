/**
 * The dressing room, as numbers: the open wardrobe and its clothes rail on
 * the left, the cheval mirror, the armchair under the arc lamp, the pile of
 * presents, the chest of drawers with the laptop and the headphones under a
 * print — from the mockup the operator validated on 2026-10-01. Units are the
 * scene's viewBox (640 × 362); the floor starts at y = 262.
 */
import type { DressingPart } from "../../registry";
import type { LabelAnchor } from "../shared/labels";

export const VIEW = { width: 640, height: 362 } as const;

/** The furniture's outlines, drawn as a ghost inside the lenses. */
export const DRESSING_OUTLINE =
  "M16,58 H228 V256 H16 Z M24,106 H220 M24,226 H220 M352,255 V150 Q352,72 396,94 " +
  "M380,112 A16,16 0 0 1 412,112 Z M344,208 V172 Q344,160 356,160 H406 Q418,160 418,172 V208 " +
  "M438,230 H474 V262 H438 Z M443,210 H469 V230 H443 Z M449,198 H463 V210 H449 Z " +
  "M484,188 H630 V250 H484 Z M520,148 H576 V186 H520 Z M512,190 L516,186 H580 L584,190 Z";

export interface LensGeometry extends LabelAnchor {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Each lens sits where the purchase is kept. The clothes rail hangs low
 * enough for the dial's label to leave its lens clear.
 */
export const LENSES: Record<DressingPart, LensGeometry> = {
  wardrobe: { cx: 122, cy: 146, r: 36, leader: { from: [122, 182], to: [122, 322] }, align: "below" },
  tech: { cx: 548, cy: 170, r: 22, leader: { from: [548, 148], to: [548, 42] }, align: "above" },
  lamp: { cx: 396, cy: 112, r: 22, leader: { from: [396, 90], to: [396, 42] }, align: "above" },
  gifts: { cx: 456, cy: 232, r: 22, leader: { from: [456, 254], to: [456, 322] }, align: "below" },
};

export type GarmentShape = "shirt" | "dress";
export type GarmentTone = "sky" | "rose" | "sand" | "lilac";

/** The rail every hanger hangs from, inside the wardrobe. */
export const RAIL_Y = 136;

/**
 * The rail's eight hangers. As many are dressed as eighths of the clothing
 * budget (or of its monthly mean) still unspent; the bare ones stay drawn as
 * dashed hangers, so an empty rail reads as empty and not as missing.
 */
export const HANGERS: ReadonlyArray<{ x: number; shape: GarmentShape; tone: GarmentTone }> = [
  { x: 92.25, shape: "shirt", tone: "sky" },
  { x: 100.75, shape: "dress", tone: "rose" },
  { x: 109.25, shape: "shirt", tone: "sand" },
  { x: 117.75, shape: "dress", tone: "lilac" },
  { x: 126.25, shape: "shirt", tone: "rose" },
  { x: 134.75, shape: "shirt", tone: "sky" },
  { x: 143.25, shape: "dress", tone: "sand" },
  { x: 151.75, shape: "shirt", tone: "lilac" },
];

/** A garment on the hanger at `x`: a shirt with short sleeves, or a dress. */
export function garmentPath(x: number, shape: GarmentShape): string {
  const top = RAIL_Y + 6;
  return shape === "shirt"
    ? `M${x - 3.5},${top} L${x - 5},${top + 3} L${x - 3.5},${top + 4} V${top + 26} H${x + 3.5} V${top + 4} L${x + 5},${top + 3} L${x + 3.5},${top} Z`
    : `M${x - 2.5},${top} L${x - 5.5},${top + 30} H${x + 5.5} L${x + 2.5},${top} Z`;
}

/** The hanger itself: its hook over the rail and its shoulders. */
export function hangerPath(x: number): string {
  return `M${x - 1.5},${RAIL_Y + 1} a1.5,1.5 0 1 1 3,0 M${x - 4.5},${RAIL_Y + 6} L${x},${RAIL_Y + 2.5} L${x + 4.5},${RAIL_Y + 6}`;
}
