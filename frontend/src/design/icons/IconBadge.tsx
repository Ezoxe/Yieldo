import type { IconComponent } from "./Icon";
import "./icons.css";

/**
 * Which of the app's meanings the badge carries. Never a colour name: a badge
 * is tinted by what it says, so "negative" stays right when the palette moves.
 */
export type IconTone = "accent" | "positive" | "negative" | "warning" | "info" | "muted";

interface IconBadgeProps {
  icon: IconComponent;
  tone?: IconTone;
  /** The row-sized badge rather than the panel-sized one. */
  small?: boolean;
  className?: string;
}

/**
 * An icon in its tinted rounded square — the mark that lets a reader find a
 * panel across a dashboard before reading a word of it.
 *
 * Always `aria-hidden` by construction (see `Icon`): the badge repeats the
 * heading beside it, and a screen reader announcing both would read the panel
 * twice. Nothing may be *only* an icon — every badge in the app sits next to
 * real text.
 */
export function IconBadge({ icon: Glyph, tone = "accent", small = false, className = "" }: IconBadgeProps) {
  const classes = [
    "yd-icon-badge",
    `yd-icon-badge--${tone}`,
    small ? "yd-icon-badge--sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden="true">
      <Glyph />
    </span>
  );
}
