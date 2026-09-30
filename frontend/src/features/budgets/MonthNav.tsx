import { ChevronIcon } from "../../design/icons";
import "./MonthNav.css";

/** "2026-01" → "janvier 2026". The month key is the API's, the words are ours. */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The month `offset` months away from `key`, in the same "AAAA-MM" shape. */
export function shiftMonth(key: string, offset: number): string {
  const [year, month] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The month arrows. One glyph, mirrored — `design/icons` owns the drawing, and
 * a second copy of it here is how two chevrons in one application end up on two
 * different grids. Rotated in CSS rather than redrawn.
 */
function MonthArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <span className={`yd-budgets__arrow yd-budgets__arrow--${direction}`}>
      <ChevronIcon />
    </span>
  );
}

interface MonthNavProps {
  /** "AAAA-MM", or "" while the first answer has not told us the month yet. */
  current: string;
  onChange: (key: string) => void;
}

/** Previous month, the month in words, next month — for Budgets and a category's page. */
export function MonthNav({ current, onChange }: MonthNavProps) {
  return (
    <div className="yd-budgets__month-nav">
      <button type="button" onClick={() => onChange(shiftMonth(current, -1))} disabled={!current}>
        <span className="sr-only">Mois précédent</span>
        <MonthArrow direction="left" />
      </button>
      <span className="yd-budgets__month" aria-live="polite">
        {current ? monthLabel(current) : ""}
      </span>
      <button type="button" onClick={() => onChange(shiftMonth(current, 1))} disabled={!current}>
        <span className="sr-only">Mois suivant</span>
        <MonthArrow direction="right" />
      </button>
    </div>
  );
}
