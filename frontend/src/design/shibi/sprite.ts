/**
 * The shibi: Yieldo's mascot, drawn pixel by pixel on a 32x32 grid.
 *
 * A small impersonal cube — a body, a visor, two square eyes, and a diode on
 * an antenna. No mouth and no eyebrows on purpose: everything it expresses, it
 * expresses through the diode's colour and the shape of its two eyes. It is
 * the face of the assistant, so what it says has to be exactly as narrow as
 * what the assistant actually knows.
 *
 * This module is pure — no DOM, no clock, no React. It answers one question:
 * given a state and a frame number, which colour is each of the 1024 pixels?
 * `Shibi.tsx` paints the answer, `ShibiSheetPage.tsx` documents it, and
 * `sprite.test.ts` holds it to its own palette.
 *
 * Every coordinate below is an integer on the 32x32 grid. That is what makes
 * this pixel art rather than a small vector drawing: nothing is ever plotted
 * at a fractional position, and the component only ever scales it by whole
 * numbers.
 */

/** The grid is square, and this is its side. */
export const SHIBI_SIZE = 32;

/**
 * The thirteen colours the character is built from, each named for the part it
 * paints. Three indigos carry the volume of the cube; the four accents are the
 * ones Yieldo already uses for meaning, and the diode never burns any other
 * hue.
 */
export const SHIBI_PALETTE = {
  ink: "#0b0b14",
  shadow: "#08080f",
  lo: "#3f3ba6",
  body: "#6f6bea",
  hi: "#a3a0fb",
  visor: "#141426",
  glass: "#242440",
  eye: "#eceaff",
  eyeDim: "#6f6e8c",
  indigo: "#8f8cf8",
  amber: "#fbbf24",
  emerald: "#34d399",
  rose: "#fb7185",
} as const;

export type ShibiColorName = keyof typeof SHIBI_PALETTE;

/** What each colour is for, in French, for the model sheet. */
export const SHIBI_PALETTE_ROLES: Record<ShibiColorName, string> = {
  ink: "Contour",
  shadow: "Ombre portée",
  lo: "Face basse",
  body: "Face avant",
  hi: "Face haute",
  visor: "Visière",
  glass: "Reflet de visière",
  eye: "Yeux",
  eyeDim: "Yeux, en veille",
  indigo: "Diode — au repos",
  amber: "Diode — il calcule",
  emerald: "Diode — il répond",
  rose: "Diode — il a échoué",
};

/** The hues the diode is allowed to burn. */
export type ShibiHue = "indigo" | "amber" | "emerald" | "rose";

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => {
    const from = (pa >> shift) & 255;
    const to = (pb >> shift) & 255;
    return Math.round(from + (to - from) * t);
  };
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return "#" + (value | (1 << 24)).toString(16).slice(1);
}

/**
 * Three steps of brightness per hue, and only three.
 *
 * The diode is the one thing on the character that varies continuously, and
 * interpolating it per frame would quietly turn a thirteen-colour sprite into
 * a sprite with hundreds of colours — which is not pixel art, whatever the
 * grid says. So the ramp is quantised here, once, and a frame picks a step.
 */
export const SHIBI_DIODE_STEPS: Record<ShibiHue, [string, string, string]> = {
  indigo: ramp("indigo"),
  amber: ramp("amber"),
  emerald: ramp("emerald"),
  rose: ramp("rose"),
};

function ramp(hue: ShibiHue): [string, string, string] {
  const c = SHIBI_PALETTE[hue];
  return [mix(SHIBI_PALETTE.ink, c, 0.28), mix(SHIBI_PALETTE.ink, c, 0.62), c];
}

/** Every colour a frame is allowed to contain. `sprite.test.ts` enforces it. */
export function shibiColors(): Set<string> {
  const all = new Set<string>(Object.values(SHIBI_PALETTE));
  for (const steps of Object.values(SHIBI_DIODE_STEPS)) {
    for (const step of steps) all.add(step);
  }
  return all;
}

/* ── The frame description ─────────────────────────────────────────────── */

type EyeShape =
  | "open"
  | "wide"
  | "half"
  | "blink"
  | "narrow"
  | "dash"
  | "glad"
  | "closed";

interface ShibiFrame {
  /** Pixels the body floats above its resting line. */
  bob?: number;
  /** Pixels the body is pushed sideways. */
  dx?: number;
  /** Positive squashes it wider and shorter, negative stretches it taller. */
  sq?: number;
  eyes: EyeShape;
  /** Eyes look this many pixels off centre. */
  eyeDX?: number;
  /**
   * Where the pupil sits inside the eye, in whole pixels from its middle.
   * Both channels are clamped to the eye's own 3x3 box, so a frame can never
   * push a pupil out of the face it belongs to.
   *
   * This is the whole of his gaze. A 3x3 eye with a single dark pixel in it
   * has nine directions to look in, which turns out to be plenty — and it is
   * the one thing that makes him read as looking AT something rather than
   * merely facing it.
   */
  pupil?: readonly [number, number];
  /**
   * The antenna trailing behind the body, in pixels.
   *
   * A mass on a stalk does not arrive at the same time as the thing carrying
   * it. One pixel of lag against the direction of travel is the difference
   * between a cube that moves and a cube that is being moved.
   */
  antennaDY?: number;
  /** The eyes lose their light — only ever true in `veille`. */
  eyeDim?: boolean;
  hue: ShibiHue;
  /** Which of the three brightness steps the diode is on. */
  diode: 0 | 1 | 2;
  /** How many of the three "he is working" dots are lit. */
  dots?: number;
  /** The halo thrown off by an answer, in pixels of radius. 0 is none. */
  ring?: number;
  /** How far the pointing arm reaches out of the right face. */
  arm?: number;
  /** The pixel that drifts off while he sleeps. */
  drift?: number;
}

export type ShibiState =
  | "repos"
  | "reflexion"
  | "reponse"
  | "erreur"
  | "designation"
  | "veille";

export interface ShibiAnimation {
  key: ShibiState;
  /** The French name shown on the model sheet. */
  name: string;
  hue: ShibiHue;
  fps: number;
  /** What this state means — the model sheet prints it, and it is the only
   *  place the contract between a state and a real situation is written. */
  note: string;
  frames: ShibiFrame[];
}

/**
 * A frame, spelled out channel by channel.
 *
 * The six states below are written as parallel arrays rather than as a list of
 * objects, because that is how an animator reads them: one row per channel,
 * one column per frame, and a mistake shows up as a bump in a column instead
 * of hiding inside a hundred braces.
 */
function frames(
  count: number,
  channels: {
    bob?: number[];
    dx?: number[];
    sq?: number[];
    antennaDY?: number[];
    eyes: EyeShape[] | EyeShape;
    eyeDX?: number[];
    pupil?: (readonly [number, number])[];
    eyeDim?: boolean;
    hue: ShibiHue;
    diode: (0 | 1 | 2)[];
    dots?: number[];
    ring?: number[];
    arm?: number[];
    drift?: number[];
  },
): ShibiFrame[] {
  const at = <T>(row: T[] | undefined, i: number): T | undefined => row?.[i];
  return Array.from({ length: count }, (_, i) => ({
    bob: at(channels.bob, i) ?? 0,
    dx: at(channels.dx, i) ?? 0,
    sq: at(channels.sq, i) ?? 0,
    antennaDY: at(channels.antennaDY, i) ?? 0,
    eyes: Array.isArray(channels.eyes) ? channels.eyes[i] : channels.eyes,
    eyeDX: at(channels.eyeDX, i) ?? 0,
    pupil: at(channels.pupil, i),
    eyeDim: channels.eyeDim,
    hue: channels.hue,
    diode: channels.diode[i],
    dots: at(channels.dots, i),
    ring: at(channels.ring, i),
    arm: at(channels.arm, i),
    drift: at(channels.drift, i),
  }));
}

/** Looking straight ahead. */
const AHEAD = [0, 0] as const;

export const SHIBI_ANIMATIONS: ShibiAnimation[] = [
  {
    key: "repos",
    name: "Repos",
    hue: "indigo",
    fps: 8,
    note:
      "Il respire. Il monte de deux pixels, retombe, s'écrase d'un pixel à " +
      "l'atterrissage, jette un coup d'œil sur le côté et cligne une fois par " +
      "cycle. C'est l'état par défaut, et celui sur lequel il se fige quand les " +
      "animations sont coupées.",
    frames: frames(16, {
      bob: [0, -1, -1, -2, -2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0],
      sq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      antennaDY: [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
      eyes: [
        "open", "open", "open", "open", "open", "open", "open", "open",
        "open", "open", "open", "half", "blink", "half", "open", "open",
      ],
      pupil: [
        AHEAD, AHEAD, AHEAD, AHEAD, [1, 0], [1, 0], [1, 0], AHEAD,
        AHEAD, AHEAD, AHEAD, AHEAD, AHEAD, AHEAD, [-1, 0], [-1, 0],
      ],
      diode: [1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      hue: "indigo",
    }),
  },
  {
    key: "reflexion",
    name: "Réflexion",
    hue: "amber",
    fps: 10,
    note:
      "Une requête est partie. Les yeux se plissent et balayent la ligne, la " +
      "pupille remonte deux fois — on cherche —, la diode passe à l'ambre et les " +
      "trois points se remplissent. Jamais une barre de progression : rien ici ne " +
      "sait combien de temps ça prendra.",
    frames: frames(12, {
      bob: [0, -1, -1, 0, 0, -1, -1, 0, 0, -1, -1, 0],
      antennaDY: [1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0],
      eyes: "narrow",
      pupil: [
        [-1, 0], [-1, 0], AHEAD, [1, 0], [1, 0], [1, -1],
        AHEAD, [-1, -1], [-1, 0], AHEAD, [1, 0], AHEAD,
      ],
      dots: [0, 1, 1, 2, 2, 3, 3, 3, 3, 0, 0, 0],
      diode: [0, 1, 1, 2, 2, 2, 1, 1, 0, 0, 1, 1],
      hue: "amber",
    }),
  },
  {
    key: "reponse",
    name: "Réponse",
    hue: "emerald",
    fps: 12,
    note:
      "La réponse est là. Il s'écrase, se détend, les yeux s'ouvrent en grand sur " +
      "l'impact puis se plissent, et un anneau part de la diode. La secousse dure " +
      "trois images : ce qui reste après, c'est un shibi content, pas une fête.",
    frames: frames(10, {
      sq: [2, 2, -2, -1, 0, 0, 0, 0, 0, 0],
      bob: [1, 1, -2, -1, 0, 0, 0, 0, 0, 0],
      antennaDY: [0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
      eyes: [
        "wide", "wide", "wide", "glad", "glad",
        "glad", "glad", "glad", "glad", "glad",
      ],
      pupil: [AHEAD, AHEAD, [0, -1]],
      ring: [0, 0, 1, 2, 3, 3, 0, 0, 0, 0],
      diode: [2, 2, 2, 2, 1, 1, 1, 1, 1, 1],
      hue: "emerald",
    }),
  },
  {
    key: "erreur",
    name: "Échec",
    hue: "rose",
    fps: 14,
    note:
      "La question n'a pas été comprise, ou le calcul a échoué. Il ferme les yeux " +
      "sur la première secousse, tremble trois fois, puis les rouvre en tirets. " +
      "Pas de croix, pas de moue : l'écran dit ce qui s'est passé, lui ne fait que " +
      "le signaler.",
    frames: frames(10, {
      dx: [-1, 1, -1, 1, -1, 1, 0, 0, 0, 0],
      antennaDY: [1, 1, 0, 0, 1, 1, 0, 0, 0, 0],
      eyes: [
        "closed", "closed", "dash", "dash", "dash",
        "dash", "dash", "dash", "dash", "dash",
      ],
      diode: [2, 2, 2, 2, 2, 2, 1, 1, 1, 1],
      hue: "rose",
    }),
  },
  {
    key: "designation",
    name: "Désignation",
    hue: "indigo",
    fps: 9,
    note:
      "Il montre l'outil dont la réponse s'est servie. Il se penche, le bras sort, " +
      "le chevron pousse vers la ligne — et la pupille part avec le bras, parce " +
      "qu'un personnage qui montre quelque chose sans le regarder ne montre rien.",
    frames: frames(10, {
      dx: [0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      bob: [0, -1, -1, 0, 0, 0, 0, 0, 0, 0],
      antennaDY: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      arm: [0, 1, 2, 3, 4, 4, 4, 3, 2, 1],
      eyes: "open",
      pupil: [
        AHEAD, [1, 0], [1, 0], [1, 0], [1, 0],
        [1, 0], [1, 0], [1, 0], AHEAD, AHEAD,
      ],
      diode: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      hue: "indigo",
    }),
  },
  {
    key: "veille",
    name: "Veille",
    hue: "indigo",
    fps: 3,
    note:
      "Personne ne lui a rien demandé depuis longtemps. Respiration lente, yeux " +
      "fermés et éteints, diode presque à zéro, et un pixel qui s'échappe vers le " +
      "haut avant de disparaître.",
    frames: frames(8, {
      bob: [0, 0, -1, -1, -1, 0, 0, 0],
      antennaDY: [1, 1, 0, 0, 0, 1, 1, 0],
      eyes: "closed",
      eyeDim: true,
      drift: [0, 1, 2, 3, 4, 5, 6, 7],
      diode: [0, 0, 0, 0, 0, 0, 0, 0],
      hue: "indigo",
    }),
  },
];

export function shibiAnimation(state: ShibiState): ShibiAnimation {
  const found = SHIBI_ANIMATIONS.find((a) => a.key === state);
  // Never a silent fallback: a state that does not exist is a bug in a call
  // site, and a shibi quietly idling would hide it.
  if (!found) throw new Error(`État de shibi inconnu : ${state}`);
  return found;
}

/* ── Painting ──────────────────────────────────────────────────────────── */

/** A painted grid: 1024 cells, each a colour or null for transparent. */
export type ShibiGrid = (string | null)[];

const S = SHIBI_SIZE;

/** Where the body sits when nothing is moving it. */
const BODY = { x: 7, y: 10, w: 18, h: 15 };

function plot(g: ShibiGrid, x: number, y: number, c: string | null | undefined): void {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  // `undefined` means "leave it alone"; `null` means "rub it out", which is
  // how the answer halo is hollowed into a ring.
  if (c === undefined) return;
  g[y * S + x] = c;
}

function rect(
  g: ShibiGrid,
  x: number,
  y: number,
  w: number,
  h: number,
  c: string | null,
): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) plot(g, x + i, y + j, c);
  }
}

/** A rounded rect whose corner is a stair of whole pixels, never a curve. */
function rrect(
  g: ShibiGrid,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  c: string | null,
): void {
  for (let j = 0; j < h; j++) {
    let inset = 0;
    if (r > 0) {
      const d = Math.min(j, h - 1 - j);
      if (d < r) inset = r - d;
    }
    for (let i = inset; i < w - inset; i++) plot(g, x + i, y + j, c);
  }
}

/**
 * Repaint a band of rows, but only where the body has already been laid down.
 * This is how the cube gets its three-value shading without a second
 * silhouette that would have to be kept in step with the first.
 */
function shadeRows(g: ShibiGrid, y0: number, y1: number, from: string, to: string): void {
  for (let y = Math.max(y0, 0); y <= Math.min(y1, S - 1); y++) {
    for (let x = 0; x < S; x++) {
      if (g[y * S + x] === from) g[y * S + x] = to;
    }
  }
}

function paint(f: ShibiFrame): ShibiGrid {
  const P = SHIBI_PALETTE;
  const g: ShibiGrid = new Array(S * S).fill(null);

  const bob = f.bob ?? 0;
  const dx = f.dx ?? 0;
  const sq = f.sq ?? 0;

  const bx = BODY.x + dx - Math.round(sq / 2);
  const by = BODY.y + bob + Math.max(sq, 0);
  const bw = BODY.w + sq;
  const bh = BODY.h - sq;

  // The cast shadow tightens as he rises. It is the only thing that says he is
  // floating rather than simply drawn higher up the canvas.
  const lift = Math.abs(Math.min(bob, 0));
  rrect(g, 9 + dx + lift, 28, 14 - lift * 2, 2, 1, P.shadow);

  // The antenna, before the head, so the head's outline crosses its stem.
  // Two pixels of stem, not three: at the top of the idle bob a longer one put
  // the diode's outline on row 0, and a sprite touching its own edge is a
  // sprite that will be cropped by the first thing that clips it.
  const lag = f.antennaDY ?? 0;
  const stemTop = by - 2 + lag;
  rect(g, bx + Math.floor(bw / 2) - 1, stemTop, 2, 3 - lag, P.lo);

  const diode = SHIBI_DIODE_STEPS[f.hue][f.diode];
  const beadX = bx + Math.floor(bw / 2) - 2;
  const beadY = stemTop - 4;

  // The halo an answer throws off, painted before the bead so the bead always
  // sits on top of its own ring.
  if (f.ring) {
    const r = f.ring;
    rrect(g, beadX - r, beadY - r, 4 + r * 2, 4 + r * 2, 1 + r, SHIBI_DIODE_STEPS[f.hue][0]);
    rrect(g, beadX - r + 1, beadY - r + 1, 2 + r * 2, 2 + r * 2, r, null);
  }

  rrect(g, beadX - 1, beadY - 1, 6, 6, 1, P.ink);
  rrect(g, beadX, beadY, 4, 4, 1, diode);

  // The head. Outline first, then one flat fill, then the two shading bands:
  // the silhouette is described once and only once.
  rrect(g, bx - 1, by - 1, bw + 2, bh + 2, 3, P.ink);
  rrect(g, bx, by, bw, bh, 2, P.body);
  shadeRows(g, by, by + 2, P.body, P.hi);
  shadeRows(g, by + bh - 3, by + bh - 1, P.body, P.lo);

  // The lit left edge and the shaded right edge: the two columns that turn a
  // rounded rectangle into a cube.
  for (let y = Math.max(by, 0); y < Math.min(by + bh, S); y++) {
    const left = g[y * S + bx];
    const right = g[y * S + bx + bw - 1];
    if (left === P.body) g[y * S + bx] = P.hi;
    if (right === P.body || right === P.hi) g[y * S + bx + bw - 1] = P.lo;
  }

  // The visor: a recessed plate with one row of reflected light along its top.
  const vx = bx + 3;
  const vy = by + 4;
  const vw = bw - 6;
  rrect(g, vx, vy, vw, 7, 1, P.visor);
  rect(g, vx + 1, vy, vw - 2, 1, P.glass);

  // The eyes: two squares and a pupil, and nothing else. Their shape carries
  // the state; where the pupil sits carries what he is looking at.
  const eyeC = f.eyeDim ? P.eyeDim : P.eye;
  const ex = f.eyeDX ?? 0;
  const ey = vy + 2;
  const clamp = (n: number, low: number, high: number) =>
    Math.min(Math.max(n, low), high);

  for (const x of [vx + 2 + ex, vx + vw - 5 + ex]) {
    switch (f.eyes) {
      case "blink":
      case "closed":
        rect(g, x, ey + 1, 3, 1, eyeC);
        break;
      case "half":
        rect(g, x, ey + 1, 3, 2, eyeC);
        break;
      case "narrow":
        rect(g, x, ey + 1, 3, 2, eyeC);
        break;
      case "wide":
        rect(g, x - 1, ey, 5, 3, eyeC);
        break;
      case "dash":
        rect(g, x, ey + 1, 3, 1, eyeC);
        plot(g, x + 1, ey, eyeC);
        break;
      case "glad":
        rect(g, x, ey + 1, 3, 2, eyeC);
        plot(g, x + 1, ey, eyeC);
        break;
      default:
        rect(g, x, ey, 3, 3, eyeC);
    }

    // Only the shapes that have an open eye to put one in. A pupil on a closed
    // lid would be a dot floating on his face.
    if (f.pupil && (f.eyes === "open" || f.eyes === "narrow" || f.eyes === "wide")) {
      const [dx0, dy0] = f.pupil;
      const wide = f.eyes === "wide";
      const left = wide ? x - 1 : x;
      const width = wide ? 5 : 3;
      const top = f.eyes === "narrow" ? ey + 1 : ey;
      const height = f.eyes === "narrow" ? 2 : 3;
      plot(
        g,
        clamp(left + Math.floor(width / 2) + dx0, left, left + width - 1),
        clamp(top + Math.floor(height / 2) + dy0, top, top + height - 1),
        P.visor,
      );
    }
  }

  // He is calculating: three dots fill up, top right.
  if (f.dots) {
    const spots: [number, number][] = [
      [21, 5],
      [25, 3],
      [28, 2],
    ];
    for (let i = 0; i < f.dots && i < spots.length; i++) {
      rect(g, spots[i][0], spots[i][1], 2, 2, P.amber);
    }
  }

  // He is pointing: an arm out of the right face, and a chevron ahead of it.
  if (f.arm) {
    rect(g, bx + bw, by + 7, f.arm, 3, P.body);
    rect(g, bx + bw, by + 7, f.arm, 1, P.hi);
    if (f.arm >= 2) {
      const cx = bx + bw + f.arm + 1;
      plot(g, cx, by + 7, P.indigo);
      plot(g, cx + 1, by + 8, P.indigo);
      plot(g, cx, by + 9, P.indigo);
    }
  }

  // He is asleep: one pixel drifting up and out.
  if (f.drift != null) {
    const d = f.drift;
    plot(g, 21 + Math.floor(d / 2), 8 - d, SHIBI_DIODE_STEPS.indigo[d > 2 ? 0 : 1]);
  }

  return g;
}

// Painting is deterministic, so a frame is drawn once for the life of the tab
// however many shibis are on screen. Forty-one grids of 1024 cells is nothing;
// repainting them sixty times a second on six canvases would not be.
const cache = new Map<string, ShibiGrid>();

export function shibiGrid(state: ShibiState, frame: number): ShibiGrid {
  const animation = shibiAnimation(state);
  const index = ((frame % animation.frames.length) + animation.frames.length) %
    animation.frames.length;
  const key = `${state}:${index}`;
  let grid = cache.get(key);
  if (!grid) {
    grid = paint(animation.frames[index]);
    cache.set(key, grid);
  }
  return grid;
}
