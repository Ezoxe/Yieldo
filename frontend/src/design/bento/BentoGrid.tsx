import type { ElementType, HTMLAttributes } from "react";

import "./Bento.css";

interface BentoGridProps extends HTMLAttributes<HTMLElement> {
  /** Pass `motion.div` to drive the entry stagger — see `staggerProps`. */
  as?: ElementType;
}

/**
 * The 12/6/1-column grid every screen lays its cells on. It holds no styling
 * decisions of its own beyond the tracks; a cell's size is the cell's business
 * (see `BentoCell`).
 */
export function BentoGrid({
  as: Component = "div",
  className = "",
  children,
  ...rest
}: BentoGridProps) {
  return (
    <Component className={`yd-bento ${className}`.trim()} {...rest}>
      {children}
    </Component>
  );
}
