function segments(path: string): string[] {
  return path.split(/[?#]/)[0].split("/").filter(Boolean);
}

/**
 * Which way a navigation goes, for the screen transition: 1 deeper into the
 * same family (`/budgets` → `/budgets/12`), −1 back up it, 0 sideways (one
 * sidebar entry to another, one category to the next).
 *
 * Deeper means the target starts with every segment of the origin and has
 * more: the new screen then arrives from the right, the way a detail opens,
 * and leaves to the right when the reader comes back.
 */
export function routeDirection(from: string, to: string): -1 | 0 | 1 {
  const origin = segments(from);
  const target = segments(to);
  const shared = (shorter: string[], longer: string[]) =>
    shorter.every((segment, index) => longer[index] === segment);
  if (target.length > origin.length && origin.length > 0 && shared(origin, target)) return 1;
  if (origin.length > target.length && target.length > 0 && shared(target, origin)) return -1;
  return 0;
}
