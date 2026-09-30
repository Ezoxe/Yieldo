/**
 * The car, as numbers. Every coordinate comes from the mockup the operator
 * validated on 2026-09-30 (`docs/superpowers/specs/assets/2026-09-30-voiture-
 * maquette.html`), itself measured on a side view of a 911 GT3: wheelbase,
 * roof height, window line, wing, mirror, fuel flap. Kept here, apart from
 * the drawing, so the body, the X-ray ghosts inside the lenses and the label
 * anchors all read the same outline.
 *
 * Units are the scene's viewBox (640 × 242); y grows downwards.
 */
import type { PartId } from "../../registry";

export const VIEW = { width: 640, height: 242 } as const;

/** The silhouette. The two arcs are the wheel arches (radius 41). */
export const BODY_PATH =
  "M167,199.7 C158,199 152,194 151.6,186.6 L150,153.8 C150,149 150.6,147 151.6,145.6 " +
  "L157.4,135.8 C159.5,131 160.8,127 161.5,125.9 L161.2,121.5 C161,119.8 162,119.3 163.1,119.3 " +
  "L187.7,118.5 C195,118 200,116.5 207.4,113.6 C213,111.5 218,110 222.2,108.7 " +
  "C228,105 235,103 245.1,99.7 C258,95.6 275,91 294.3,86.6 C315,83 335,80.4 353.4,80 " +
  "C366,80 378,81 389.4,83.3 C396,84.7 400,87 402.6,88.2 L468.2,121 C472,121.2 480,121 487.8,121 " +
  "C505,121.5 525,125 543.6,128.4 C552,130 558,134 563.3,138.2 C572,144.5 590,151 598,156 " +
  "C604,159.5 606.7,162 606.7,165 L606.2,173.5 C605.5,176.5 603,178 601.8,178.5 L600,188 " +
  "C602,190 606.5,191.5 607.6,193.2 C607.8,196.5 605,199.5 600,199.7 L544.23,199.7 " +
  "A41,41 0 1 0 474.17,199.7 L285.84,199.7 A41,41 0 1 0 217.56,199.7 Z";

export const REAR_QUARTER_PATH =
  "M254.1,111.2 C258,108.3 262,106.3 269.7,103.8 C278,101.2 287,98.5 294.3,96.4 " +
  "C305,93.8 316,91.8 327.1,90.3 L327.1,118.5 L294.3,117.7 C285,117.3 272,116.3 263.2,114.4 " +
  "C259,113.5 256,112.5 254.1,111.2 Z";

export const DOOR_WINDOW_PATH =
  "M332.9,89.4 C340,88.8 346,88.4 351.7,88.2 C360,88 368,88.4 376.3,89 C381,89.4 386,89.8 391.1,90.3 " +
  "L434.5,121.8 L335.3,120.2 L332.9,119.4 Z";

export const WINDSHIELD_PATH = "M394.4,87.4 C397,87.6 400,87.8 402.6,88.2 L468.2,121 L438.6,121.8 Z";

export const REAR_DOOR_EDGE = "M321.5,120 C320.8,140 321.5,158 325,168 C329,178 336,184 344,187.5";
export const FRONT_DOOR_EDGE = "M446,123.5 C449,140 452,160 452.5,175 C452.8,182 452,187 451,190";

export interface WheelGeometry {
  cx: number;
  cy: number;
  tire: number;
  rim: number;
  disc: number;
  holes: number;
  holesDash: string;
  hat: number;
  nut: number;
  /** The upper arc of tread that catches the light. */
  tread: string;
  /** The rim's upper highlight. */
  gleam: string;
  caliper: string;
  caliperGleam: string;
  /** Five double spokes, as one path of ten segments. */
  spokes: string;
  arch: string;
}

export const REAR_WHEEL: WheelGeometry = {
  cx: 251.7,
  cy: 177,
  tire: 36.9,
  rim: 29.5,
  disc: 23.5,
  holes: 20.5,
  holesDash: ".1 5.3",
  hat: 9,
  nut: 5.6,
  tread: "M221.5,158 A36,36 0 0 1 281.9,158",
  gleam: "M235,158 A22,22 0 0 1 268,158",
  // In front of the rear disc, as on the reference.
  caliper: "M274.36,166.43 A25,25 0 0 1 269.38,194.68 L263.01,188.31 A16,16 0 0 0 266.2,170.24 Z",
  caliperGleam: "M272.5,169.5 A22,22 0 0 1 270,188",
  spokes:
    "M251.36,170.51 L246.75,148.93 M252.04,170.51 L256.65,148.93 M257.77,174.67 L276.86,163.62 " +
    "M257.98,175.32 L279.92,173.03 M255.79,182.05 L272.2,196.8 M255.24,182.45 L264.19,202.62 " +
    "M248.16,182.45 L239.21,202.62 M247.61,182.05 L231.2,196.8 M245.42,175.32 L223.48,173.03 " +
    "M245.63,174.67 L226.54,163.62",
  arch: "M217.56,199.7 A41,41 0 1 1 285.84,199.7",
};

export const FRONT_WHEEL: WheelGeometry = {
  cx: 509.2,
  cy: 178.4,
  tire: 35.5,
  rim: 28.7,
  disc: 22.8,
  holes: 19.9,
  holesDash: ".1 5.1",
  hat: 8.7,
  nut: 5.4,
  tread: "M480.1,160.1 A34.6,34.6 0 0 1 538.3,160.1",
  gleam: "M492.5,160 A21,21 0 0 1 525.5,160",
  // Behind the front disc, as on the reference.
  caliper: "M492.23,195.37 A24,24 0 0 1 487.45,168.26 L495.15,171.85 A15.5,15.5 0 0 0 498.24,189.36 Z",
  caliperGleam: "M489.5,190 A21.5,21.5 0 0 1 488.3,172",
  spokes:
    "M508.87,172.11 L504.39,151.12 M509.53,172.11 L514.01,151.12 M515.08,176.14 L533.66,165.39 " +
    "M515.29,176.77 L536.63,174.54 M513.16,183.3 L529.12,197.64 M512.63,183.68 L521.34,203.3 " +
    "M505.77,183.68 L497.06,203.3 M505.24,183.3 L489.28,197.64 M503.11,176.77 L481.77,174.54 " +
    "M503.32,176.14 L484.74,165.39",
  arch: "M474.17,199.7 A41,41 0 1 1 544.23,199.7",
};

export interface LensGeometry {
  cx: number;
  cy: number;
  r: number;
  /** Where the leader leaves the ring, and where it meets the label. */
  leader: { from: [number, number]; to: [number, number] };
  /** How the label sits against `leader.to`. */
  align: "above" | "left";
}

/** Each lens sits where its part really is in a rear-engined GT. */
export const LENSES: Record<PartId, LensGeometry> = {
  // The tank: behind the front axle, under the front lid.
  fuel: { cx: 487.8, cy: 150.5, r: 30, leader: { from: [509, 129.3], to: [566, 42] }, align: "above" },
  // The flat-six: behind the rear axle.
  engine: { cx: 212.3, cy: 160.4, r: 32, leader: { from: [180.3, 160.4], to: [112, 160] }, align: "left" },
  // The roll cage, seen through the rear quarter window.
  cage: { cx: 298.4, cy: 106.2, r: 22, leader: { from: [292, 84.2], to: [286, 42] }, align: "above" },
  // The toll badge, behind the interior mirror.
  toll: { cx: 405, cy: 93.1, r: 14, leader: { from: [405, 79.1], to: [426, 42] }, align: "above" },
};

/** The fuel tank inside its lens: a rounded box behind the front wheel. */
export const TANK = {
  path:
    "M466,146 C466,142 469,140 473,140 L503,140 C508,140 511,142.5 511,147 L511,158 " +
    "C511,162 508,164 504,164 L472,164 C468.5,164 466,161.5 466,158 Z",
  top: 140,
  height: 24,
} as const;

/** The gauge dial, top left: centre, arc radius, and where its label hangs
 *  (from the dial's left edge, so it never runs off the scene). */
export const DIAL = { cx: 40, cy: 40, r: 30, arc: 24, label: [10, 74] as [number, number] } as const;
