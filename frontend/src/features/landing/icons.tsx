/**
 * The landing page's icon set. Inline SVG, never emoji (MASTER.md forbids
 * emoji-as-icon), and never a fetched sprite — the page's own claim is that
 * nothing leaves the machine, so an icon CDN would contradict it on the very
 * screen that makes the claim.
 *
 * All of them share one grid: 24x24, 1.6px stroke, round caps and joins, no
 * fill, `currentColor`. That is the Lucide geometry, so any later icon
 * borrowed from that set drops in without redrawing.
 */
interface IconProps {
  className?: string;
}

function Icon({ className = "", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={`yd-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
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

/** A file with an arrow going into it — importing a statement. */
export function FileImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l6 6" />
      <path d="M12 11v6" />
      <path d="m9.5 14.5 2.5 2.5 2.5-2.5" />
    </Icon>
  );
}

/** Table columns with a check — the mapping the user confirms. */
export function ColumnsCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />
      <path d="M3 5v14a2 2 0 0 0 2 2h6" />
      <path d="M3 9h18" />
      <path d="M9 9v12" />
      <path d="m15 17 2.5 2.5L22 15" />
    </Icon>
  );
}

/** A tag — categorisation. */
export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.6 3.4H5a1.6 1.6 0 0 0-1.6 1.6v6.6a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l6-6a2 2 0 0 0 0-2.8l-7-7a2 2 0 0 0-1.2-.8Z" />
      <circle cx="7.6" cy="7.6" r="1.3" />
    </Icon>
  );
}

/** Bars in a frame — the dashboard. */
export function ChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 16v-4" />
      <path d="M12 16V7" />
      <path d="M17 16v-6" />
    </Icon>
  );
}

/** A magnifier — search and recategorisation. */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </Icon>
  );
}

/** Sliders — the display settings. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 21v-7" />
      <path d="M5 10V3" />
      <path d="M12 21v-10" />
      <path d="M12 7V3" />
      <path d="M19 21v-4" />
      <path d="M19 13V3" />
      <path d="M3 14h4" />
      <path d="M10 11h4" />
      <path d="M17 17h4" />
    </Icon>
  );
}

/** A bank with a slash through it — not an aggregator. */
export function BankOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 11v7" />
      <path d="M19 11v7" />
      <path d="M3 21h18" />
      <path d="m4 4 16 16" />
    </Icon>
  );
}

/** An open padlock with a slash — no bank credentials are ever asked for. */
export function KeyOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 7.5-1.9" />
      <path d="m3.5 3.5 17 17" />
    </Icon>
  );
}

/** A house holding a shield — the data stays on the machine you host. */
export function HomeShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10.2 12 3.5l8.5 6.7" />
      <path d="M5.5 12v7.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V12" />
      <path d="M12 11.2c.9.7 1.9 1 3 1v2.4c0 1.6-1.1 3-3 3.6-1.9-.6-3-2-3-3.6v-2.4c1.1 0 2.1-.3 3-1Z" />
    </Icon>
  );
}

/** A clock — the features that are not here yet. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

/** The Yieldo mark: a rounded frame with a rising line inside it. */
export function YieldoMark({ className = "" }: IconProps) {
  return (
    <svg
      className={`yd-landing__mark ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1.6"
        y="1.6"
        width="20.8"
        height="20.8"
        rx="6.4"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <path
        d="M6.5 15.5 10 11.6l2.8 2.5L17.5 8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="8" r="1.7" fill="currentColor" />
    </svg>
  );
}
