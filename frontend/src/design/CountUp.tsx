import { animate } from "motion";
import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "./motion/useReducedMotion";

interface CountUpProps {
  value: number;
  format: (value: number) => string;
  duration?: number;
  className?: string;
}

export function CountUp({ value, format, duration = 0.9, className = "" }: CountUpProps) {
  const reducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(reducedMotion ? value : 0);
  const previous = useRef(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) {
      setDisplayed(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplayed(latest),
      onComplete: () => {
        previous.current = value;
      },
    });
    return () => controls.stop();
  }, [value, duration, reducedMotion]);

  // The animated digits are decorative noise for a screen reader; the label is the truth.
  return (
    <span role="status" aria-label={format(value)} className={`yd-num ${className}`}>
      <span aria-hidden="true">{format(displayed)}</span>
    </span>
  );
}
