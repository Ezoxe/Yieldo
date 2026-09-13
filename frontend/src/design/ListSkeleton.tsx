import "./Skeleton.css";
import "./ListSkeleton.css";

interface ListSkeletonProps {
  /** How many rows the real list usually shows on this screen. */
  rows?: number;
  /** What is being waited for, for the reader who cannot see the shimmer. */
  label: string;
}

/**
 * A list's stand-in while it loads: one shimmering bar per row, sized like
 * a row of text, announced once as busy.
 *
 * Five screens used to print « Chargement… » in a paragraph, or nothing at
 * all, where their list would land; the bento cell then jumped from a line
 * of text to a full list. A skeleton of the same height as the list keeps
 * the layout still, which is the whole reason skeletons exist.
 */
export function ListSkeleton({ rows = 6, label }: ListSkeletonProps) {
  return (
    <div className="yd-list-skeleton" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="yd-skeleton yd-list-skeleton__row" aria-hidden="true" />
      ))}
    </div>
  );
}
