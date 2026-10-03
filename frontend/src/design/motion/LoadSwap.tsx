import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { useReducedMotion } from "./useReducedMotion";
import { EXIT_EASE } from "./variants";
import "./LoadSwap.css";

/** True once `flag` has stayed true for `delay` ms; false again at once. */
export function useDelayedFlag(flag: boolean, delay: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!flag) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [flag, delay]);
  return flag && elapsed;
}

interface LoadSwapProps {
  loading: boolean;
  /** The screen's own skeleton, shaped like what it stands for. */
  skeleton: ReactNode;
  children: ReactNode;
  /** How long a wait has to last before it is shown, in ms. */
  delay?: number;
}

/**
 * The wait between a screen and its data, drawn only when there is one.
 *
 * Under 150ms — a local server, most of the time — no skeleton at all: the
 * content arrives once, with its own entry, instead of a skeleton flashing
 * between the screen and itself. Longer, the skeleton fades in, holds the
 * shape of the cards, and when the data lands it fades out IN PLACE while the
 * content takes its room (`popLayout` takes the leaving skeleton out of flow
 * at once): no moment with neither, which is the blink the old swap had.
 */
export function LoadSwap({ loading, skeleton, children, delay = 150 }: LoadSwapProps) {
  const reduced = useReducedMotion();
  const showSkeleton = useDelayedFlag(loading, delay);

  if (reduced) return <>{loading ? (showSkeleton ? skeleton : null) : children}</>;

  return (
    <div className="yd-load-swap">
      <AnimatePresence mode="popLayout" initial={false}>
        {loading ? (
          showSkeleton ? (
            <motion.div
              key="skeleton"
              className="yd-load-swap__layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.16, ease: EXIT_EASE } }}
              exit={{ opacity: 0, transition: { duration: 0.2, ease: EXIT_EASE } }}
            >
              {skeleton}
            </motion.div>
          ) : null
        ) : (
          <motion.div key="content" className="yd-load-swap__layer">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
