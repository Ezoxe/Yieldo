import type { ReactNode } from "react";

import { IconBadge, type IconTone } from "../icons/IconBadge";
import type { IconComponent } from "../icons/Icon";
import "./Bento.css";

interface PanelHeadProps {
  /** The panel's mark. Always paired with the title — never a lone icon. */
  icon: IconComponent;
  tone?: IconTone;
  children: ReactNode;
  /** A short qualifier under the title: a period, a count, a unit. */
  subtitle?: ReactNode;
  /** Controls that belong to this panel, aligned to the far edge of the row. */
  actions?: ReactNode;
  /** Heading level. `h2` inside a page whose `h1` is the screen title. */
  as?: "h2" | "h3";
  className?: string;
}

/**
 * The head of a bento panel: a tinted mark, the title, and whatever controls
 * belong to the panel, on one aligned row with a hairline under it.
 *
 * Every panel in the app wears one, which is what makes a screen scannable —
 * the marks line up down the page and the reader finds the panel they want
 * before reading a word. The title is still real text: the icon is decoration
 * (`aria-hidden`), never the accessible name.
 */
export function PanelHead({
  icon,
  tone = "accent",
  children,
  subtitle,
  actions,
  as: Heading = "h2",
  className = "",
}: PanelHeadProps) {
  return (
    <div className={`yd-panel__head ${className}`.trim()}>
      <IconBadge icon={icon} tone={tone} />
      <div className="yd-panel__heading">
        <Heading className="yd-panel__title">{children}</Heading>
        {subtitle ? <p className="yd-panel__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="yd-panel__actions">{actions}</div> : null}
    </div>
  );
}
