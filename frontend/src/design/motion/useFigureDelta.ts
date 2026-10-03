import { useEffect, useState } from "react";

import { figureMemory } from "./sessionMemory";

/**
 * How much a figure moved since the reader last looked at the SAME figure —
 * what a DeltaPill prints.
 *
 * Its own memory key, distinct from the AnimatedNumber's: the number rolls
 * from whatever the slot last showed (the previous month too, when the month
 * changes), but the pill compares like with like — this figure, this period
 * — so it never presents a change of month as a change of money. Zero the
 * first time, and for a figure that did not move.
 */
export function useFigureDelta(key: string | undefined, value: number): number {
  const read = (candidate: string | undefined) =>
    candidate === undefined ? undefined : figureMemory.recall(candidate);
  const [baseline, setBaseline] = useState(() => ({ key, before: read(key) }));

  let current = baseline;
  if (baseline.key !== key) {
    current = { key, before: read(key) };
    setBaseline(current);
  }

  useEffect(() => {
    if (key !== undefined) figureMemory.remember(key, value);
  }, [key, value]);

  return current.before === undefined ? 0 : value - current.before;
}
