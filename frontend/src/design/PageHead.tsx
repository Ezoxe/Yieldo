import type { ReactNode } from "react";

import { useMediaQuery } from "../lib/useMediaQuery";
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
  /**
   * The same lead, said in a line or two, for a phone.
   *
   * On a 375px screen a 300-character lead is nine lines: the head fills the
   * first screenful and the reader scrolls past the whole of it before seeing
   * a single figure. So the long one is not truncated — it is replaced by a
   * shorter one somebody wrote, which keeps the claim the long one makes
   * instead of cutting it off mid-sentence.
   *
   * It REPLACES `children` rather than hiding it with a media query: a lead
   * rendered twice is a lead that has to be kept true twice, and the copy
   * `display: none` covers is the one nobody re-reads. Only pass this from a
   * screen whose `children` are prose — anything else under the title would
   * disappear with them.
   */
  shortLead?: ReactNode;
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
  shortLead,
  actions,
  className = "",
}: PageHeadProps) {
  // The same breakpoint PageHead.css already uses to stack the head's own row.
  const narrow = useMediaQuery("(max-width: 639px)");
  const lead = narrow && shortLead ? shortLead : children;

  return (
    <div className={`yd-page-head ${className}`.trim()}>
      <IconBadge icon={icon} tone={tone} className="yd-page-head__mark" />
      <div className="yd-page-head__text">
        <h1>{title}</h1>
        {lead}
      </div>
      {actions ? <div className="yd-page-head__actions">{actions}</div> : null}
    </div>
  );
}
