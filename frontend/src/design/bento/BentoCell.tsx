import type { CSSProperties, ElementType, HTMLAttributes } from "react";

import "./Bento.css";

export interface BentoSpan {
  /** Columns spanned below 768px, where the grid is 1 column wide. */
  base?: number;
  /** Columns spanned from 768px, where the grid is 6 columns wide. */
  md?: number;
  /** Columns spanned from 1200px, where the grid is 12 columns wide. */
  lg?: number;
}

interface BentoCellProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  span?: BentoSpan;
  /** Rows spanned, at every breakpoint. */
  rows?: number;
  /**
   * Adds the hover lift and the focus ring. The caller is responsible for
   * rendering a focusable element (`as="button"` or a link) — a bare div would
   * get the pointer cursor and never the focus ring.
   */
  interactive?: boolean;
  /**
   * Forwarded when the cell is rendered as a `<button>`. Declared explicitly
   * because a button with no `type` submits whatever form it lands in.
   */
  type?: "button" | "submit" | "reset";
}

/**
 * One tile of the bento grid. Spans travel as inline custom properties rather
 * than as an inline `grid-column`, because Bento.css's media queries have to be
 * able to swap them per breakpoint and an inline declaration would win over
 * every one of them.
 */
export function BentoCell({
  as: Component = "div",
  span,
  rows = 1,
  interactive = false,
  className = "",
  style,
  children,
  ...rest
}: BentoCellProps) {
  const md = span?.md ?? 6;
  const spanStyle = {
    "--yd-cell-span-base": span?.base ?? 1,
    "--yd-cell-span-md": md,
    "--yd-cell-span-lg": span?.lg ?? md,
    "--yd-cell-rows": rows,
    ...style,
  } as CSSProperties;

  const classes = [
    "yd-bento__cell",
    interactive ? "yd-bento__cell--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component className={classes} style={spanStyle} {...rest}>
      {children}
    </Component>
  );
}
