import { motion } from "motion/react";

import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { SIGNATURE_EASE } from "../../design/motion/variants";
import "./PeriodSelector.css";
import type { PeriodPreset, UsePeriodResult } from "./usePeriod";

const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "month", label: "Mois" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Année" },
  { value: "ytd", label: "Depuis janvier" },
  { value: "all", label: "Tout" },
  { value: "custom", label: "Personnalisé" },
];

interface PeriodSelectorProps {
  period: UsePeriodResult;
}

// The period-preset control shared by the transactions filter bar and the
// overview dashboard. Both screens read and write the exact same
// ?periode=&du=&au= query parameters through usePeriod() -- this component
// is the one place that renders the control itself, so the two screens'
// pickers cannot drift the way two hand-maintained copies eventually would.
export function PeriodSelector({ period }: PeriodSelectorProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className="yd-period-selector">
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
              value={period.from}
              onChange={(event) => period.setRange(event.target.value, period.to)}
            />
          </label>
          <label className="yd-period-selector__field">
            <span>Au</span>
            <input
              type="date"
              value={period.to}
              onChange={(event) => period.setRange(period.from, event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
