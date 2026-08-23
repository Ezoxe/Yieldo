import { useSearchParams } from "react-router";

export type PeriodPreset = "month" | "quarter" | "year" | "ytd" | "all" | "custom";

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function endOfMonth(year: number, monthIndex: number): Date {
  // Day 0 of the next month is the last day of this one — handles leap years for free.
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

export function periodBounds(preset: PeriodPreset, today: Date): { from: string; to: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  switch (preset) {
    case "month":
      return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(endOfMonth(year, month)) };
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

export interface UsePeriodResult {
  preset: PeriodPreset;
  from: string;
  to: string;
  setPreset: (next: PeriodPreset) => void;
  setRange: (from: string, to: string) => void;
}

// The period lives in the URL (?periode=&du=&au=) rather than component state so
// the transactions view survives a reload and can be shared as a link — and so
// task 20's dashboard can read the exact same period through this same hook.
//
// `defaultPreset` is what a screen opens on when the URL names no period at
// all; the URL always wins over it. It exists because "this month" is not the
// right opening question everywhere. The analysis screen passes "all", whose
// empty bounds are dropped by `api.get` so each backend route resolves its own
// window from the ledger (the last twelve complete months for inflation, the
// ledger's own span for anomalies). Pointed at the real calendar month instead,
// a ledger whose statements stopped months ago answers with a refusal whose
// stated cause — too few months of data — is not the real one.
export function usePeriod(defaultPreset: PeriodPreset = "month"): UsePeriodResult {
  const [params, setParams] = useSearchParams();
  const rawPreset = params.get("periode");
  const preset: PeriodPreset = isPreset(rawPreset) ? rawPreset : defaultPreset;
  const bounds =
    preset === "custom"
      ? { from: params.get("du") ?? "", to: params.get("au") ?? "" }
      : periodBounds(preset, new Date());

  const setPreset = (next: PeriodPreset) => {
    const nextBounds = periodBounds(next, new Date());
    setParams({ periode: next, du: nextBounds.from, au: nextBounds.to });
  };

  const setRange = (from: string, to: string) => {
    setParams({ periode: "custom", du: from, au: to });
  };

  return { preset, from: bounds.from, to: bounds.to, setPreset, setRange };
}
