import { useEffect, useRef, useState } from "react";

import type { Account, Category } from "../../lib/types";
import { CategoryPicker } from "./CategoryPicker";
import { PeriodSelector } from "./PeriodSelector";
import type { UsePeriodResult } from "./usePeriod";

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

  // Plain content: the BentoCell around it (TransactionsPage's SPAN.filters)
  // is the surface. The period and the four filters are siblings in one band
  // rather than two stacked rows -- side by side once there is width for it,
  // stacked when there is not.
  return (
    <div className="yd-filterbar">
      <PeriodSelector period={period} />

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
    </div>
  );
}
