import type { ReactNode } from "react";

import "./icons.css";

/**
 * The app's single icon primitive.
 *
 * One grid for every icon in Yieldo: 24x24, 1.6px stroke, round caps and
 * joins, no fill, `currentColor`. That is the Lucide geometry, so any icon
 * later borrowed from that set drops in without being redrawn — and nothing is
 * ever fetched, which is the same promise the rest of the app makes.
 *
 * Never an emoji: an emoji is a glyph in the reader's font, it cannot take
 * `currentColor`, and it renders differently on every platform.
 */
export interface IconProps {
  className?: string;
  /** Edge length in px. Defaults to 1em so an icon tracks the text beside it. */
  size?: number | string;
}

export function Icon({
  className = "",
  size,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={`yd-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size ?? undefined}
      height={size ?? undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** The component type every icon in `set.tsx` has. */
export type IconComponent = (props: IconProps) => ReactNode;
