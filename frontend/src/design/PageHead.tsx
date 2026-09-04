import type { ReactNode } from "react";

import { IconBadge, type IconTone } from "./icons/IconBadge";
import type { IconComponent } from "./icons/Icon";
import "./PageHead.css";

interface PageHeadProps {
  /** The screen's mark — the same one the sidebar shows for this entry. */
  icon: IconComponent;
  tone?: IconTone;
  title: ReactNode;
  /** The screen's lead paragraph, and anything else that belongs under the
   *  title. */
  children?: ReactNode;
  /** Controls belonging to the screen as a whole, pinned to the far edge. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The head of a screen: its mark, its `h1`, its lead, and any screen-level
 * control, on one row.
 *
 * The mark is the same glyph the sidebar shows for the same destination, which
 * is what ties the two together — a reader arriving from the nav sees the mark
 * they just clicked at the top of the page. It is decoration (`aria-hidden`),
 * never the accessible name: the `h1` alone names the screen.
 */
export function PageHead({
  icon,
  tone = "accent",
  title,
  children,
  actions,
  className = "",
}: PageHeadProps) {
  return (
    <div className={`yd-page-head ${className}`.trim()}>
      <IconBadge icon={icon} tone={tone} className="yd-page-head__mark" />
      <div className="yd-page-head__text">
        <h1>{title}</h1>
        {children}
      </div>
      {actions ? <div className="yd-page-head__actions">{actions}</div> : null}
    </div>
  );
}
