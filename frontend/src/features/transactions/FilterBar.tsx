import { useEffect, useId, useRef, useState } from "react";

import { FilterIcon, SearchIcon } from "../../design/icons";
import type { Account } from "../../lib/types";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { PeriodSelector } from "./PeriodSelector";
import type { UsePeriodResult } from "./usePeriod";

const SEARCH_DEBOUNCE_MS = 250;

interface FilterBarProps {
  period: UsePeriodResult;
  accounts: Account[];
  accountId: number | null;
  onAccountChange: (accountId: number | null) => void;
  uncategorizedOnly: boolean;
  onUncategorizedOnlyChange: (value: boolean) => void;
  uncategorizedCount: number | null;
  includeTransfers: boolean;
  onIncludeTransfersChange: (value: boolean) => void;
  /**
   * How many rows of the period are internal transfers, whether or not they
   * are on screen. Null while it is not known yet. Without it the switch is a
   * control with no consequence to read: the list simply gets shorter and
   * nothing says by how much.
   */
  transferCount: number | null;
  onSearchChange: (value: string) => void;
  /**
   * What the box starts with. The super-search in the header hands a term to
   * this screen through the URL, and a box that showed nothing while the list
   * below it was filtered would be the shortened list this screen refuses.
   */
  initialSearch?: string;
}

export function FilterBar({
  period,
  accounts,
  accountId,
  onAccountChange,
  uncategorizedOnly,
  onUncategorizedOnlyChange,
  uncategorizedCount,
  includeTransfers,
  onIncludeTransfersChange,
  transferCount,
  onSearchChange,
  initialSearch = "",
}: FilterBarProps) {
  const [searchInput, setSearchInput] = useState(initialSearch);

  // Seen at 390: the filter band took the first 250px of the screen before a
  // single row. On a phone the period and the one box stay in sight, and the
  // account select and the two switches fold behind a button. The button
  // counts the folded filters that are doing something to the list, because
  // a folded filter the reader forgot is the shortened list this screen
  // refuses to show quietly. `includeTransfers` counts when ON: off is the
  // default and the list matches the figures every other screen prints.
  const phone = useMediaQuery("(max-width: 639px)");
  const [unfolded, setUnfolded] = useState(false);
  const foldId = useId();
  const activeCount =
    (accountId !== null ? 1 : 0) + (uncategorizedOnly ? 1 : 0) + (includeTransfers ? 1 : 0);
  const foldOpen = !phone || unfolded;

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
  // is the surface. The period and the filters are siblings in one band rather
  // than two stacked rows -- side by side once there is width for it, stacked
  // when there is not.
  //
  // ONE text box. There used to be two side by side -- "Rechercher un
  // libellé…" and a searchable category combobox -- which asked the reader to
  // know which of the two held the answer before they had it. The single box
  // matches the label, the amount, the category, the account and the date; the
  // account select and the two switches stay, because a list of choices and a
  // switch are not searches and never looked like one.
  return (
    <div className="yd-filterbar">
      <PeriodSelector period={period} />

      <div className="yd-filterbar__row">
        <label className="yd-filterbar__field yd-filterbar__field--search">
          <span className="sr-only">Rechercher</span>
          {/* Inside the field's border, so the pair reads as one control. The
              accessible name is still the label above it — the mark is
              decoration and carries nothing the label does not. */}
          <SearchIcon />
          <input
            type="search"
            placeholder="Rechercher : libellé, montant, catégorie, compte, date…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>

        {phone ? (
          <button
            type="button"
            className="yd-filterbar__fold"
            aria-expanded={unfolded}
            aria-controls={foldId}
            onClick={() => setUnfolded((open) => !open)}
          >
            <FilterIcon />
            {activeCount === 0
              ? "Filtres"
              : `Filtres (${activeCount} ${activeCount === 1 ? "actif" : "actifs"})`}
          </button>
        ) : null}
      </div>

      <div
        id={foldId}
        className={`yd-filterbar__row yd-filterbar__row--folding${foldOpen ? "" : " yd-filterbar__row--closed"}`}
        hidden={!foldOpen}
      >
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

        {/* Off by default, and the count says what that costs. Money moved
            between your own accounts is not spending, so the list matches the
            figures every other screen prints — but a list quietly shortened is
            worse than no filter at all, which is what the number is for. */}
        <label className="yd-filterbar__toggle">
          <input
            type="checkbox"
            role="switch"
            checked={includeTransfers}
            aria-checked={includeTransfers}
            onChange={(event) => onIncludeTransfersChange(event.target.checked)}
          />
          <span>
            Inclure les virements internes
            {transferCount !== null ? (
              <span className="yd-filterbar__count"> ({transferCount})</span>
            ) : null}
          </span>
        </label>
      </div>
    </div>
  );
}
