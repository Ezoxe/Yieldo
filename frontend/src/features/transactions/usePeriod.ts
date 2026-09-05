import { useSearchParams } from "react-router";

export type PeriodPreset = "month" | "quarter" | "year" | "ytd" | "all" | "custom";

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function endOfMonth(year: number, monthIndex: number): Date {
  // Day 0 of the next month is the last day of this one — handles leap years for free.
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

/** How far back the quick month chips reach: the current month and the two
 *  before it. Statements for the month in progress are rarely in hand, so the
 *  month that is actually complete is the one worth opening on — see
 *  `usePeriod`'s `defaultMonthOffset`. */
export const MONTH_OFFSETS = [-2, -1, 0] as const;

/**
 * The bounds a preset resolves to on a given day.
 *
 * `monthOffset` only means anything for the "month" preset, where it counts
 * whole calendar months backwards from today: 0 is the month in progress, -1
 * the last complete one. `Date.UTC` normalises a negative month index on its
 * own, so December and January need no special case.
 */
export function periodBounds(
  preset: PeriodPreset,
  today: Date,
  monthOffset = 0,
): { from: string; to: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  switch (preset) {
    case "month": {
      const shifted = new Date(Date.UTC(year, month + monthOffset, 1));
      return {
        from: iso(shifted),
        to: iso(endOfMonth(shifted.getUTCFullYear(), shifted.getUTCMonth())),
      };
    }
    case "quarter": {
      const firstMonth = Math.floor(month / 3) * 3;
      return {
        from: iso(new Date(Date.UTC(year, firstMonth, 1))),
        to: iso(endOfMonth(year, firstMonth + 2)),
      };
    }
    case "year":
      return { from: iso(new Date(Date.UTC(year, 0, 1))), to: iso(endOfMonth(year, 11)) };
    case "ytd":
      return { from: iso(new Date(Date.UTC(year, 0, 1))), to: iso(today) };
    case "all":
    case "custom":
      return { from: "", to: "" };
  }
}

const PRESETS: PeriodPreset[] = ["month", "quarter", "year", "ytd", "all", "custom"];

function isPreset(value: string | null): value is PeriodPreset {
  return value !== null && (PRESETS as string[]).includes(value);
}

/** The `?mois=` parameter, clamped to the offsets the picker can actually
 *  express. Anything else in the URL — a typo, a hand-edited link, a value
 *  from a future version — falls back to the caller's own default rather than
 *  silently showing a month no control on screen is highlighting. */
function readOffset(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return (MONTH_OFFSETS as readonly number[]).includes(parsed) ? parsed : fallback;
}

export interface UsePeriodResult {
  preset: PeriodPreset;
  /** Whole calendar months back from today, for the "month" preset only. */
  monthOffset: number;
  from: string;
  to: string;
  setPreset: (next: PeriodPreset) => void;
  /** Selects the "month" preset at a given offset in one write. */
  setMonth: (offset: number) => void;
  setRange: (from: string, to: string) => void;
}

// The period lives in the URL (?periode=&mois=&du=&au=) rather than component
// state so the transactions view survives a reload and can be shared as a link
// — and so the dashboard can read the exact same period through this same hook.
//
// `defaultPreset` is what a screen opens on when the URL names no period at
// all; the URL always wins over it. It exists because "this month" is not the
// right opening question everywhere. The analysis screen passes "all", whose
// empty bounds are dropped by `api.get` so each backend route resolves its own
// window from the ledger (the last twelve complete months for inflation, the
// ledger's own span for anomalies). Pointed at the real calendar month instead,
// a ledger whose statements stopped months ago answers with a refusal whose
// stated cause — too few months of data — is not the real one.
//
// `defaultMonthOffset` is the same idea one level down, and the dashboard is
// why it exists: a household fills in the month that is over, because the
// month in progress has no statement yet. Opening the dashboard on a month
// nobody has imported shows an empty screen and calls it a result.
export function usePeriod(
  defaultPreset: PeriodPreset = "month",
  defaultMonthOffset = 0,
): UsePeriodResult {
  const [params, setParams] = useSearchParams();
  const rawPreset = params.get("periode");
  const preset: PeriodPreset = isPreset(rawPreset) ? rawPreset : defaultPreset;
  const monthOffset = readOffset(params.get("mois"), defaultMonthOffset);
  const bounds =
    preset === "custom"
      ? { from: params.get("du") ?? "", to: params.get("au") ?? "" }
      : periodBounds(preset, new Date(), monthOffset);

  const setPreset = (next: PeriodPreset) => {
    const nextBounds = periodBounds(next, new Date(), monthOffset);
    setParams({
      periode: next,
      mois: String(monthOffset),
      du: nextBounds.from,
      au: nextBounds.to,
    });
  };

  const setMonth = (offset: number) => {
    const nextBounds = periodBounds("month", new Date(), offset);
    setParams({
      periode: "month",
      mois: String(offset),
      du: nextBounds.from,
      au: nextBounds.to,
    });
  };

  const setRange = (from: string, to: string) => {
    setParams({ periode: "custom", mois: String(monthOffset), du: from, au: to });
  };

  return { preset, monthOffset, from: bounds.from, to: bounds.to, setPreset, setMonth, setRange };
}
