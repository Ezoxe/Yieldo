import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { GlassCard } from "../../design/glass/GlassCard";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import type { Account, Category } from "../../lib/types";
import { CategoryPicker } from "./CategoryPicker";
import type { PeriodPreset, UsePeriodResult } from "./usePeriod";

const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "month", label: "Mois" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Année" },
  { value: "ytd", label: "Depuis janvier" },
  { value: "all", label: "Tout" },
  { value: "custom", label: "Personnalisé" },
];

const SEARCH_DEBOUNCE_MS = 250;

interface FilterBarProps {
  period: UsePeriodResult;
  accounts: Account[];
  categories: Category[];
  accountId: number | null;
  onAccountChange: (accountId: number | null) => void;
  categoryId: number | null;
  onCategoryChange: (categoryId: number | null) => void;
  uncategorizedOnly: boolean;
  onUncategorizedOnlyChange: (value: boolean) => void;
  uncategorizedCount: number | null;
  onSearchChange: (value: string) => void;
}

export function FilterBar({
  period,
  accounts,
  categories,
  accountId,
  onAccountChange,
  categoryId,
  onCategoryChange,
  uncategorizedOnly,
  onUncategorizedOnlyChange,
  uncategorizedCount,
  onSearchChange,
}: FilterBarProps) {
  const reducedMotion = useReducedMotion();
  const [searchInput, setSearchInput] = useState("");

  // The latest callback lives in a ref so the debounce effect below only ever
  // depends on `searchInput` -- a fresh onSearchChange identity every render
  // (TransactionsPage defines it inline) must not restart the 250ms timer.
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onSearchChangeRef.current(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  return (
    <GlassCard tone="raised" as="div" className="yd-filterbar">
      <div className="yd-filterbar__tabs" role="tablist" aria-label="Période">
        {PRESET_OPTIONS.map((option) => {
          const active = period.preset === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              className="yd-filterbar__tab"
              onClick={() => period.setPreset(option.value)}
            >
              {active && !reducedMotion ? (
                <motion.span
                  layoutId="yd-filterbar-indicator"
                  className="yd-filterbar__tab-indicator"
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                />
              ) : active ? (
                <span className="yd-filterbar__tab-indicator" />
              ) : null}
              <span className="yd-filterbar__tab-label">{option.label}</span>
            </button>
          );
        })}
      </div>

      {period.preset === "custom" ? (
        <div className="yd-filterbar__range">
          <label className="yd-filterbar__field">
            <span>Du</span>
            <input
              type="date"
              value={period.from}
              onChange={(event) => period.setRange(event.target.value, period.to)}
            />
          </label>
          <label className="yd-filterbar__field">
            <span>Au</span>
            <input
              type="date"
              value={period.to}
              onChange={(event) => period.setRange(period.from, event.target.value)}
            />
          </label>
        </div>
      ) : null}

      <div className="yd-filterbar__row">
        <label className="yd-filterbar__field yd-filterbar__field--search">
          <span className="sr-only">Rechercher</span>
          <input
            type="search"
            placeholder="Rechercher un libellé…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>

        <label className="yd-filterbar__field">
          <span className="sr-only">Compte</span>
          <select
            value={accountId ?? ""}
            onChange={(event) =>
              onAccountChange(event.target.value === "" ? null : Number(event.target.value))
            }
          >
            <option value="">Tous les comptes</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>

        <div className="yd-filterbar__field">
          {/* A distinct accessible name from the per-row "Catégorie" select in
              TransactionRow -- otherwise the two are indistinguishable to
              anything (tests included) that looks a control up by its label. */}
          <CategoryPicker
            value={categoryId}
            onChange={onCategoryChange}
            categories={categories}
            label="Filtrer par catégorie"
          />
        </div>

        <label className="yd-filterbar__toggle">
          <input
            type="checkbox"
            role="switch"
            checked={uncategorizedOnly}
            aria-checked={uncategorizedOnly}
            onChange={(event) => onUncategorizedOnlyChange(event.target.checked)}
          />
          <span>
            Non catégorisées uniquement
            {uncategorizedCount !== null ? (
              <span className="yd-filterbar__count"> ({uncategorizedCount})</span>
            ) : null}
          </span>
        </label>
      </div>
    </GlassCard>
  );
}
