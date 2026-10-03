/**
 * What the reader has already seen, for this session only.
 *
 * The « Fluide » motion moves a figure, a bar or a chart from the value the
 * reader last saw to the value it has now — never from zero on every visit,
 * and not at all when nothing changed. That needs a memory of what was shown,
 * and the operator chose the narrowest one (spec 2026-10-03, option A): kept
 * in memory, never written to storage, emptied with the session — a figure of
 * someone's household does not outlive their logout on a shared machine.
 *
 * Plain maps rather than a store: nothing renders FROM the memory, a figure
 * only reads it once when it mounts, and a store would re-render every
 * subscriber each time any figure was remembered.
 */
const figures = new Map<string, number>();
const charts = new Map<string, string>();

export const figureMemory = {
  recall(key: string): number | undefined {
    return figures.get(key);
  },
  remember(key: string, value: number): void {
    figures.set(key, value);
  },
};

/** A chart remembers the signature of the data it last drew (chartAnimation). */
export const chartMemory = {
  recall(key: string): string | undefined {
    return charts.get(key);
  },
  remember(key: string, signature: string): void {
    charts.set(key, signature);
  },
};

/** Called when the session is cleared — logout, or a refresh that failed. */
export function forgetSessionMemory(): void {
  figures.clear();
  charts.clear();
}
