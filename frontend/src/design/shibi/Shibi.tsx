import { useEffect, useRef } from "react";

import { useReducedMotion } from "../motion/useReducedMotion";
import {
  SHIBI_SIZE,
  shibiAnimation,
  shibiGrid,
  type ShibiState,
} from "./sprite";
import "./Shibi.css";

interface ShibiProps {
  /** Which of the six states he is in. See `sprite.ts` for what each means. */
  state?: ShibiState;
  /**
   * Whole multiples only. A pixel sprite drawn at 1.5x has half its pixels
   * two device pixels wide and half of them three, which is the one way to
   * make pixel art look like a mistake — so this is an integer, and the
   * component never accepts a CSS size.
   */
  scale?: number;
  /**
   * What a screen reader is told. Null keeps him out of the accessibility tree
   * entirely, which is right wherever he sits beside text that already says
   * the same thing — the header button, for one.
   */
  label?: string | null;
  className?: string;
}

/**
 * The shibi, on a canvas.
 *
 * The drawing lives in `sprite.ts` and is pure; this is the part that owns a
 * clock and a canvas. One `requestAnimationFrame` loop per mounted shibi, and
 * the loop only ever repaints when the frame actually changes — at three to
 * fourteen images a second, that is a handful of paints per second rather than
 * sixty.
 *
 * Under reduced motion — the OS preference or the Réglages switch — he holds
 * the first frame of his state. Not the first frame of `repos`: a shibi frozen
 * mid-error would still have to be showing the error.
 */
export function Shibi({
  state = "repos",
  scale = 1,
  label = null,
  className = "",
}: ShibiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const zoom = Math.max(1, Math.round(scale));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // jsdom hands back a stub and a browser without 2D would hand back null.
    // Nothing to draw on is not a crash, but it is not a silent success
    // either: the canvas stays empty and its accessible name still stands.
    if (!ctx) return;

    const animation = shibiAnimation(state);
    let frame = 0;
    let raf = 0;
    let last = 0;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const grid = shibiGrid(state, frame);
      for (let y = 0; y < SHIBI_SIZE; y++) {
        for (let x = 0; x < SHIBI_SIZE; x++) {
          const colour = grid[y * SHIBI_SIZE + x];
          if (colour === null) continue;
          ctx.fillStyle = colour;
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      }
    };

    draw();
    if (reduced) return;

    const step = 1000 / animation.fps;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < step) return;
      last = now;
      frame = (frame + 1) % animation.frames.length;
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, zoom, reduced]);

  return (
    <canvas
      ref={canvasRef}
      className={`yd-shibi ${className}`.trim()}
      width={SHIBI_SIZE * zoom}
      height={SHIBI_SIZE * zoom}
      data-state={state}
      role={label === null ? "presentation" : "img"}
      aria-hidden={label === null ? true : undefined}
      aria-label={label ?? undefined}
    />
  );
}
