import { animate } from "motion";
import { useEffect, useRef, useState } from "react";

import { figureMemory } from "./sessionMemory";
import { useReducedMotion } from "./useReducedMotion";
import { SIGNATURE_EASE } from "./variants";

/** What a level says, the moment it says it: amber from 80 %, rose from 100 %. */
export type RatioTone = "ok" | "at_risk" | "over";

export function ratioTone(ratio: number): RatioTone {
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "at_risk";
  return "ok";
}

interface AnimatedRatio {
  /** The level on screen right now, on its way to the true one. */
  ratio: number;
  /** The tone of the level on screen — it flips at the very moment the bar
   *  crosses 80 % or 100 %, which is when the reader sees it cross. */
  tone: RatioTone;
  /** False while the bar is still travelling. */
  settled: boolean;
}

/**
 * A bar's level, moving from what the reader last saw to what it is now.
 *
 * The first time a bar is seen it fills from empty, once — its length is a
 * proportion, and filling it is how the eye reads the proportion. After that
 * it moves from the remembered level (session memory, under `key`), so a
 * ceiling crossed since the last visit is crossed again on screen, and a bar
 * that did not change does not move. Motion off: the true level at once.
 */
export function useAnimatedRatio(key: string | undefined, ratio: number): AnimatedRatio {
  const reduced = useReducedMotion();
  const [start] = useState(() => (key === undefined ? 0 : (figureMemory.recall(key) ?? 0)));
  const [shown, setShown] = useState(reduced ? ratio : start);
  const current = useRef(reduced ? ratio : start);

  useEffect(() => {
    if (key !== undefined) figureMemory.remember(key, ratio);
    const from = current.current;
    if (reduced || from === ratio) {
      current.current = ratio;
      setShown(ratio);
      return;
    }
    const controls = animate(from, ratio, {
      duration: 0.56,
      ease: SIGNATURE_EASE,
      onUpdate: (latest) => {
        current.current = latest;
        setShown(latest);
      },
      onComplete: () => {
        current.current = ratio;
        setShown(ratio);
      },
    });
    return () => controls.stop();
  }, [ratio, reduced, key]);

  return { ratio: shown, tone: ratioTone(shown), settled: shown === ratio };
}
