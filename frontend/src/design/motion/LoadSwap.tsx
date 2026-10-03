import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { useReducedMotion } from "./useReducedMotion";
import { EXIT_EASE } from "./variants";
import "./LoadSwap.css";

interface LoadSwapProps {
  loading: boolean;
  /** The screen's own skeleton, shaped like what it stands for. */
  skeleton: ReactNode;
  /** The screen's content; not rendered while `loading`. */
  children: ReactNode;
}

/**
 * The wait between a screen and its data, seen only when there is one.
 *
 * The skeleton is in the document at once — announced as busy, holding the
 * shape of the cards — but it only becomes VISIBLE after 150ms (LoadSwap.css):
 * a local server answers in 40ms, and a skeleton drawn for that long was a
 * flash between the screen and itself. When the data lands, the skeleton
 * fades out IN PLACE while the content takes its room (`popLayout` lifts the
 * leaving skeleton out of flow at once): no moment with neither, which is the
 * blink the old swap had.
 *
 * Motion off swaps outright; the 150ms before a skeleton shows still applies,
 * since it is about not flashing, not about moving.
 */
export function LoadSwap({ loading, skeleton, children }: LoadSwapProps) {
  const reduced = useReducedMotion();
  const waiting = <div className="yd-load-swap__wait">{skeleton}</div>;

  if (reduced) return <>{loading ? waiting : children}</>;

  return (
    <div className="yd-load-swap">
      <AnimatePresence mode="popLayout" initial={false}>
        {loading ? (
          <motion.div
            key="skeleton"
            className="yd-load-swap__layer"
            exit={{ opacity: 0, transition: { duration: 0.2, ease: EXIT_EASE } }}
          >
            {waiting}
          </motion.div>
        ) : (
          <motion.div key="content" className="yd-load-swap__layer">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
