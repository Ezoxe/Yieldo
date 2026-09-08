import { describe, expect, it } from "vitest";

import {
  SHIBI_ANIMATIONS,
  SHIBI_PALETTE,
  SHIBI_PALETTE_ROLES,
  SHIBI_SIZE,
  shibiAnimation,
  shibiColors,
  shibiGrid,
  type ShibiState,
} from "./sprite";

/** Every state, every frame — the whole sprite, once. */
function everyFrame(): Array<{ state: ShibiState; frame: number }> {
  return SHIBI_ANIMATIONS.flatMap((a) =>
    a.frames.map((_, frame) => ({ state: a.key, frame })),
  );
}

describe("the shibi's animations", () => {
  it("carries the six states the application asks it for", () => {
    expect(SHIBI_ANIMATIONS.map((a) => a.key)).toEqual([
      "repos",
      "reflexion",
      "reponse",
      "erreur",
      "designation",
      "veille",
    ]);
  });

  it("gives every state a name, a rate and a sentence saying what it means", () => {
    for (const animation of SHIBI_ANIMATIONS) {
      expect(animation.frames.length).toBeGreaterThan(0);
      expect(animation.fps).toBeGreaterThan(0);
      expect(animation.name).not.toBe("");
      // The note is the only place the contract between a state and a real
      // situation is written down. A state without one is a state nobody can
      // use correctly.
      expect(animation.note.length).toBeGreaterThan(40);
    }
  });

  // A silent fallback here would be a shibi idling politely over a call site
  // that asked for something that does not exist.
  it("refuses a state it does not have", () => {
    expect(() => shibiAnimation("dormir" as ShibiState)).toThrow(/inconnu/);
  });
});

describe("the shibi's pixels", () => {
  it("fills exactly one 32x32 grid per frame", () => {
    for (const { state, frame } of everyFrame()) {
      expect(shibiGrid(state, frame)).toHaveLength(SHIBI_SIZE * SHIBI_SIZE);
    }
  });

  // The whole point of a limited palette: a frame that introduced a blended
  // colour would still land on the grid, and would still be wrong.
  it("paints nothing outside its own palette", () => {
    const allowed = shibiColors();
    for (const { state, frame } of everyFrame()) {
      for (const cell of shibiGrid(state, frame)) {
        if (cell === null) continue;
        expect(allowed, `${state}:${frame} peint ${cell}`).toContain(cell);
      }
    }
  });

  it("draws a character on every frame, never an empty grid", () => {
    for (const { state, frame } of everyFrame()) {
      const painted = shibiGrid(state, frame).filter((c) => c !== null).length;
      // The body alone is well over two hundred pixels; anything near zero is
      // a frame whose maths put the character off the canvas.
      expect(painted, `${state}:${frame}`).toBeGreaterThan(200);
    }
  });

  it("keeps the character clear of the top and bottom edges", () => {
    for (const { state, frame } of everyFrame()) {
      const grid = shibiGrid(state, frame);
      // Row 0 and row 31 must stay empty: a sprite touching its own edge is a
      // sprite that has been cropped.
      for (let x = 0; x < SHIBI_SIZE; x++) {
        expect(grid[x], `${state}:${frame} déborde en haut`).toBeNull();
        expect(
          grid[(SHIBI_SIZE - 1) * SHIBI_SIZE + x],
          `${state}:${frame} déborde en bas`,
        ).toBeNull();
      }
    }
  });

  it("is the same grid every time it is asked for one", () => {
    expect(shibiGrid("repos", 0)).toBe(shibiGrid("repos", 0));
    // And a frame number past the end wraps rather than throwing.
    expect(shibiGrid("repos", 8)).toBe(shibiGrid("repos", 0));
  });

  it("burns a different diode in each state that means something different", () => {
    const beads = new Map<string, string>();
    for (const animation of SHIBI_ANIMATIONS) {
      beads.set(animation.key, animation.hue);
    }
    expect(beads.get("reflexion")).toBe("amber");
    expect(beads.get("reponse")).toBe("emerald");
    expect(beads.get("erreur")).toBe("rose");
    expect(beads.get("repos")).toBe("indigo");
  });
});

describe("the shibi's palette", () => {
  it("names what every colour is for, in French", () => {
    for (const name of Object.keys(SHIBI_PALETTE)) {
      expect(SHIBI_PALETTE_ROLES[name as keyof typeof SHIBI_PALETTE]).toBeTruthy();
    }
    expect(Object.keys(SHIBI_PALETTE_ROLES)).toHaveLength(
      Object.keys(SHIBI_PALETTE).length,
    );
  });

  it("writes every colour as a six-digit hex", () => {
    for (const value of shibiColors()) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
