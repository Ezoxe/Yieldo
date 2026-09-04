import { Icon, type IconProps } from "./Icon";

/**
 * Every icon the application uses, drawn on the one grid `Icon` defines.
 *
 * Named after WHAT THEY MEAN in this app, not after their shape: `AlertsIcon`,
 * not `BellIcon`. A screen asking for "the alerts mark" keeps working when the
 * mark is redrawn, and two screens naming the same concept cannot drift onto
 * two different glyphs.
 */

/* -- Navigation ----------------------------------------------------------- */

/** Vue d'ensemble — four panes of a dashboard. */
export function OverviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  );
}

/** Transactions — two flows crossing, money in and money out. */
export function TransactionsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h13" />
      <path d="m14 4 3 3-3 3" />
      <path d="M20 17H7" />
      <path d="m10 14-3 3 3 3" />
    </Icon>
  );
}

/** Budgets — a wallet with its clasp. */
export function BudgetsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M21 14h-4a2 2 0 0 1 0-4h4z" />
    </Icon>
  );
}

/** Récurrences — a cycle that comes back round. */
export function RecurrencesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 3l3 3-3 3" />
      <path d="M4 12V9a3 3 0 0 1 3-3h13" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M20 12v3a3 3 0 0 1-3 3H4" />
    </Icon>
  );
}

/** Trésorerie — the level of the water left in the account. */
export function CashflowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 3-2" />
      <path d="M3 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 3-2" />
      <path d="M3 20c2.5 0 2.5 1.4 5 1.4" />
    </Icon>
  );
}

/** Analyse — a trace with its own reading. */
export function AnalysisIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h3l2.5-6 4 13L15 12h6" />
    </Icon>
  );
}

/** Dettes — a card with an instalment line. */
export function DebtsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6.5 14.5h4" />
    </Icon>
  );
}

/** Objectifs — a target with something aimed at its centre. */
export function GoalsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </Icon>
  );
}

/** Suivi — the streak, kept alight. */
export function StreakIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3s5 4 5 8a5 5 0 0 1-10 0c0-1.5.7-2.8 1.5-3.8C9.4 8.6 10 9.4 10 10.5c0-2.4 2-4.5 2-7.5Z" />
      <path d="M12 21a5 5 0 0 0 5-5" />
    </Icon>
  );
}

/** Alertes — a bell. */
export function AlertsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </Icon>
  );
}

/** Patrimoine — layers of holdings stacked. */
export function PortfolioIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 2.5 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12.5 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </Icon>
  );
}

/** Projection — a curve reaching forward. */
export function ProjectionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 15c2-6 5-8 12-9" />
      <path d="M15 6h4v4" />
    </Icon>
  );
}

/** Faisabilité — a balance weighing one side against the other. */
export function FeasibilityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M4 7h16" />
      <path d="M6.5 7 4 13h5z" />
      <path d="M17.5 7 15 13h5z" />
    </Icon>
  );
}

/** Simulateurs — a calculator. */
export function SimulatorsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <path d="M8 6.5h8" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
      <path d="M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" />
      <path d="M8.5 18.5h7" />
    </Icon>
  );
}

/** Assistant — a conversation. */
export function AssistantIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z" />
      <path d="M9 11h6M9 14.5h3.5" />
    </Icon>
  );
}

/** Export IA — a document leaving the machine. */
export function ExportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M19 11v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5" />
      <path d="M12 17v-6" />
      <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
    </Icon>
  );
}

/** Catégories — a tag. */
export function CategoriesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.6 3H5a2 2 0 0 0-2 2v6.6a2 2 0 0 0 .6 1.4l7.4 7.4a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8L13 3.6a2 2 0 0 0-1.4-.6Z" />
      <path d="M7.5 7.5h.01" />
    </Icon>
  );
}

/** Import — a statement going into the machine. */
export function ImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M19 11v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5" />
      <path d="M12 11v6" />
      <path d="m9.5 14.5 2.5 2.5 2.5-2.5" />
    </Icon>
  );
}

/** Réglages — the usual cog. */
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Icon>
  );
}

/** Connexions — a plug, for the market and model keys. */
export function ConnectionsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
      <path d="M12 17v5" />
    </Icon>
  );
}

/* -- Meaning, not navigation ---------------------------------------------- */

/** Money coming in. */
export function InflowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20V5" />
      <path d="m6 11 6-6 6 6" />
    </Icon>
  );
}

/** Money going out. */
export function OutflowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v15" />
      <path d="m6 13 6 6 6-6" />
    </Icon>
  );
}

/** A rise. */
export function TrendUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Icon>
  );
}

/** A fall. */
export function TrendDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 7 6 6 4-4 8 8" />
      <path d="M15 17h6v-6" />
    </Icon>
  );
}

/** A savings rate, a share, anything expressed out of a hundred. */
export function RateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </Icon>
  );
}

/** A share of a whole — the breakdown by category. */
export function BreakdownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15.5 3.6A9 9 0 0 1 20.4 8.5h-4.9z" />
    </Icon>
  );
}

/** A period, a date, a calendar strip. */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </Icon>
  );
}

/** Something out of the ordinary, worth a look but not a failure. */
export function AnomalyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

/** A statement of fact the reader has to take in before the figures. */
export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Icon>
  );
}

/** Something the app measured and is confident about. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icon>
  );
}

/** Dismiss, remove, close. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 5 14 14M19 5 5 19" />
    </Icon>
  );
}

/** Add. */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** Filter a list down. */
export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </Icon>
  );
}

/** Search. */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </Icon>
  );
}

/** Take a copy away with you. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4 20h16" />
    </Icon>
  );
}

/** Disclosure, in its closed state. Rotate for the open one. */
export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}

/** The recurring subscriptions total, and money as an object. */
export function CoinsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="9" cy="6.5" rx="6" ry="3" />
      <path d="M3 6.5v5c0 1.7 2.7 3 6 3s6-1.3 6-3" />
      <path d="M3 11.5v5c0 1.7 2.7 3 6 3 1 0 2-.1 2.8-.3" />
      <ellipse cx="16.5" cy="14.5" rx="4.5" ry="2.5" />
      <path d="M12 14.5v3c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5v-3" />
    </Icon>
  );
}

/** Set aside, saved, put by. */
export function SavingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 9.5a7 7 0 0 0-4-2H10a6 6 0 0 0-6 6c0 1.9.9 3.6 2.3 4.7V21h3v-1.5h4V21h3v-2.4c1-.7 1.7-1.7 2-2.9h1.7V11h-1.5a6 6 0 0 0-.5-1.5Z" />
      <path d="M15.5 12h.01" />
      <path d="M10 7.5A3 3 0 0 1 13.5 4" />
    </Icon>
  );
}

/** A run of time, an elapsed span. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.3 2" />
    </Icon>
  );
}

/** The theme control. */
export function ThemeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

/** The mobile drawer's handle. */
export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

/** A list of rows. */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Icon>
  );
}

/** A price that moved. */
export function PriceChangeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 20V9" />
      <path d="M12 20V4" />
      <path d="M18 20v-7" />
      <path d="M3 20h18" />
    </Icon>
  );
}

/* -- Brand ---------------------------------------------------------------- */

/**
 * The Yieldo mark: a rising trace inside a rounded frame, ending on a filled
 * point. Not drawn on the stroke grid the icons above share — it carries its
 * own weights and a fill, because a wordmark is a drawing, not an icon.
 */
export function YieldoMark({ className = "", size }: IconProps) {
  return (
    <svg
      className={`yd-mark ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size ?? undefined}
      height={size ?? undefined}
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

/* -- Row and form actions -------------------------------------------------- */

/** Edit in place. */
export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  );
}

/** Put away without deleting — what "Archiver" does everywhere in this app. */
export function ArchiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
      <path d="M5 8.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" />
      <path d="M10 12.5h4" />
    </Icon>
  );
}

/** Delete for good. Reserved for what really is irreversible. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M6.5 7v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </Icon>
  );
}

/** Write it down — the mark on every "Enregistrer". */
export function SaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3.5h11L20.5 8v12.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M8 3.5V9h7V3.5" />
      <path d="M7.5 14.5h9v7h-9z" />
    </Icon>
  );
}

/** Start again from the measured values. */
export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </Icon>
  );
}

/* -- Account --------------------------------------------------------------- */

/** The person the account belongs to. */
export function AccountIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Icon>
  );
}

/** A secret: the password, and nothing else. */
export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </Icon>
  );
}

/** Appearance: theme, density, motion. */
export function AppearanceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" opacity="0.55" />
    </Icon>
  );
}

/** Leaving: the session ends. */
export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9" />
    </Icon>
  );
}
