import type { CSSProperties } from "react";

import { useAnimatedRatio } from "./useAnimatedRatio";

interface AnimatedFillProps {
  /** The true level, 0 to 1 (more is drawn as a full track). */
  ratio: number;
  /** The level's slot in the session memory — the fill moves from what the
   *  reader last saw there (useAnimatedRatio). */
  memoryKey?: string;
  className: string;
  /**
   * Whether the fill takes the colour of the level on screen while it travels
   * (amber from 80 %, rose from 100 %) — for a ceiling, where more is worse.
   * A goal's progress is not toned: more is the point.
   */
  toned?: boolean;
  style?: CSSProperties;
  "data-testid"?: string;
}

/**
 * The inside of a progress track that fills from what the reader last saw —
 * empty the first time, once — and sits still when nothing changed. The track
 * around it, its role and its value for assistive technology stay with the
 * caller: they state the true figure, never a passing one.
 */
export function AnimatedFill({
  ratio,
  memoryKey,
  className,
  toned = false,
  style,
  "data-testid": testId,
}: AnimatedFillProps) {
  const level = useAnimatedRatio(memoryKey, Number.isFinite(ratio) ? ratio : 0);
  const percent = Math.round(Math.max(0, Math.min(1, level.ratio)) * 1000) / 10;
  return (
    <div
      className={className}
      data-tone={toned && !level.settled ? level.tone : undefined}
      data-testid={testId}
      style={{ ...style, width: `${percent}%` }}
    />
  );
}
