import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { SIGNATURE_EASE } from "../../design/motion/variants";
import "./PeriodSelector.css";
import { MONTH_OFFSETS, type PeriodPreset, type UsePeriodResult } from "./usePeriod";

// "Mois" is deliberately absent: the three named chips above the tabs ARE the
// month preset, one per offset, and a seventh tab saying "Mois" would be a
// second control for the same thing pointing at whichever offset happened to
// be selected.
const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Année" },
  { value: "ytd", label: "Depuis janvier" },
  { value: "all", label: "Tout" },
  { value: "custom", label: "Personnalisé" },
];

const MONTH_NAMES = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

/** The chip's label: the month's own name, plus the year only when it is not
 *  the current one. In March the three chips read Janvier / Février / Mars; in
 *  January they read "Novembre 2025", "Décembre 2025", "Janvier" — the year
 *  appears exactly where its absence would be ambiguous. */
export function monthChipLabel(today: Date, offset: number): string {
  const shifted = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
  const name = MONTH_NAMES.format(shifted);
  const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
  return shifted.getUTCFullYear() === today.getUTCFullYear()
    ? capitalised
    : `${capitalised} ${shifted.getUTCFullYear()}`;
}

/** A date the user has finished writing, as opposed to one they are halfway
 *  through. `<input type="date">` fires a change for every keystroke that
 *  leaves the field parseable, so the first digit of the year produces the
 *  perfectly valid year 2 — committing that would rewrite the URL, refetch
 *  the screen and hand the input a new value mid-edit. An empty field is
 *  "finished" too: clearing a bound is a legitimate edit. */
function isSettled(value: string): boolean {
  if (value === "") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000;
}

interface PeriodSelectorProps {
  period: UsePeriodResult;
  /** Injected by the tests so the chip labels are not a moving target. */
  today?: Date;
}

// The period control shared by the transactions filter bar and the overview
// dashboard. Both screens read and write the exact same ?periode=&mois=&du=&au=
// query parameters through usePeriod() -- this component is the one place that
// renders the control itself, so the two screens' pickers cannot drift the way
// two hand-maintained copies eventually would.
export function PeriodSelector({ period, today = new Date() }: PeriodSelectorProps) {
  const reducedMotion = useReducedMotion();

  // The custom range is typed into a local buffer and only reported once it is
  // settled -- see `isSettled`. Without it every keystroke of the year wrote
  // the URL, and the value coming back down reset the field's own segments:
  // typing 05/09/2026 ended up as some other date entirely.
  const [draft, setDraft] = useState({ from: period.from, to: period.to });

  // A range changed from outside (a preset click, the back button, the empty
  // state's "show me everything" button) replaces whatever is in the buffer.
  useEffect(() => {
    setDraft({ from: period.from, to: period.to });
  }, [period.from, period.to]);

  const commit = (next: { from: string; to: string }) => {
    if (next.from === period.from && next.to === period.to) return;
    if (!isSettled(next.from) || !isSettled(next.to)) return;
    period.setRange(next.from, next.to);
  };

  return (
    <div className="yd-period-selector">
      <div className="yd-period-selector__months" role="tablist" aria-label="Mois">
        {MONTH_OFFSETS.map((offset) => {
          const active = period.preset === "month" && period.monthOffset === offset;
          return (
            <button
              key={offset}
              type="button"
              role="tab"
              aria-selected={active}
              className="yd-period-selector__month"
              onClick={() => period.setMonth(offset)}
            >
              {monthChipLabel(today, offset)}
            </button>
          );
        })}
      </div>

      <div className="yd-period-selector__tabs" role="tablist" aria-label="Période">
        {PRESET_OPTIONS.map((option) => {
          const active = period.preset === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              className="yd-period-selector__tab"
              onClick={() => period.setPreset(option.value)}
            >
              {active && !reducedMotion ? (
                <motion.span
                  layoutId="yd-period-selector-indicator"
                  className="yd-period-selector__tab-indicator"
                  transition={{ duration: 0.28, ease: SIGNATURE_EASE }}
                />
              ) : active ? (
                <span className="yd-period-selector__tab-indicator" />
              ) : null}
              <span className="yd-period-selector__tab-label">{option.label}</span>
            </button>
          );
        })}
      </div>

      {period.preset === "custom" ? (
        <div className="yd-period-selector__range">
          <label className="yd-period-selector__field">
            <span>Du</span>
            <input
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              onBlur={() => commit(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit(draft);
              }}
            />
          </label>
          <label className="yd-period-selector__field">
            <span>Au</span>
            <input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              onBlur={() => commit(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit(draft);
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
