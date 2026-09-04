import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { EmptyState, historySentence } from "../../design/EmptyState";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type {
  Account,
  Category,
  History,
  Transaction,
  TransactionPage as TransactionPageBody,
  TransactionPatchResult,
} from "../../lib/types";
import { FilterBar } from "./FilterBar";
import { TransactionRow } from "./TransactionRow";
import "./TransactionsPage.css";
import { usePeriod } from "./usePeriod";
import { TransactionsIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";

const PAGE_SIZE = 50;
const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * The shape of the screen, in one place. Two cells, both full width, and the
 * hierarchy is the row count: the filter band is one track tall, the list is
 * three. The list is what this screen exists for and it takes strictly the
 * largest area on the grid -- there is a test over that.
 *
 * Deliberately not a filter rail beside the table: at 1200px, where the 12
 * column grid starts, a four-column rail is 243px wide once the sidebar and
 * the cell's own padding are taken out, which wraps the six period tabs onto
 * four lines and squeezes the category picker below its minimum. Full width
 * lets the period tabs and the four controls share a single 60px band.
 */
const SPAN = {
  filters: { base: 1, md: 6, lg: 12 },
  list: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** The list stands three tracks tall; the filter band, one. */
const LIST_ROWS = 3;

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

export interface ActiveFilters {
  search: string;
  accountName: string | null;
  categoryName: string | null;
  uncategorizedOnly: boolean;
}

/**
 * The filters currently narrowing the list, named the way the reader set them.
 *
 * The period is deliberately not one of them: it is its own diagnosis (the
 * period holds nothing at all), with its own way out, and lumping it in here
 * would offer to "clear" a control the user can plainly see.
 */
export function activeFilterLabels(filters: ActiveFilters): string[] {
  const labels: string[] = [];
  if (filters.search) labels.push(`la recherche « ${filters.search} »`);
  if (filters.categoryName) labels.push(`la catégorie « ${filters.categoryName} »`);
  if (filters.accountName) labels.push(`le compte « ${filters.accountName} »`);
  if (filters.uncategorizedOnly) labels.push("« Non catégorisées uniquement »");
  return labels;
}

/** Why this period's transactions are not on screen, filter by filter. */
export function filteredEmptyDetail(periodTotal: number, labels: string[]): string {
  const held = `Cette période contient ${periodTotal} ${plural(periodTotal, "transaction", "transactions")}.`;
  if (labels.length === 0) return held;
  return `${held} ${plural(labels.length, "Filtre actif", "Filtres actifs")} : ${labels.join(", ")}.`;
}

// What just happened after a category change that taught the categorizer a
// rule and backfilled other rows. `origin` distinguishes the original
// correction (which can offer an Annuler) from a notice raised by the undo
// itself (which cannot -- see the module doc comment below). `previousCategoryId`
// is only meaningful for a "correction" notice: it is what makes Undo possible
// at all.
interface BackfillNotice {
  transactionId: number;
  previousCategoryId: number | null;
  count: number;
  origin: "correction" | "undo";
}

// Honesty note (see task-19 brief, "Careful points" #3): PATCH /transactions/{id}
// operates on a single row and never tells the caller *which* other rows a
// learned rule touched -- only how many (`backfilled`). So "Annuler" here can
// only ever undo the one row the user just edited, by putting its own previous
// category back. It cannot -- and does not claim to -- reverse the N backfilled
// siblings; doing that would need a bulk-revert endpoint that does not exist
// (learning a rule off the *reverted* category would apply going forward, not
// retroactively to what the first rule already touched). When the edited row
// itself had no previous category (it was uncategorized before), single-row
// undo is still not offered here: the backend's PATCH does accept an explicit
// `category_id: null` to clear a category (see backend/app/api/transactions.py),
// but that path deliberately skips learn_from_correction -- there is no category
// left to learn a rule from -- so an undo-to-uncategorized could never carry its
// own "Règle apprise" notice the way every other undo here does. Rather than
// special-case that one asymmetric branch, the banner says plainly that undo
// is unavailable for this row instead of offering a button with a different
// side-effect profile from the rest.
//
// The undo itself is *also* a category change, so the backend runs the exact
// same learn-and-backfill side effect on it (see patch_transaction in
// backend/app/api/transactions.py, which does not special-case "this PATCH
// happens to be an undo"). Reusing the "Règle apprise" notice for that result
// would be actively misleading -- the user pressed Annuler, not Corriger, so
// a second learn/backfill announcement in the same wording reads as a leftover
// from the correction they just reverted, not a new event. handleUndo reports
// it as its own, differently-worded, purely informational notice instead of
// discarding it (the fix-round-1 finding this addresses) or reusing the
// correction wording (which would misattribute it).
//
// That notice deliberately does NOT chain into its own Annuler. Doing so is
// possible in principle -- the row's pre-undo category is knowable -- but a
// learned rule's category is stored per pattern and overwritten wholesale by
// learn_from_correction on every correction (see backend/app/categorization/
// learning.py), not versioned. Undoing the undo would flip that single shared
// rule's category back again and could itself backfill and re-announce,
// forever as long as the user keeps clicking -- an oscillation with no natural
// end, not a bounded undo. An informational banner the user can only dismiss
// by moving on is safer than a button that invites exactly that loop.
export function TransactionsPage() {
  const period = usePeriod();
  const reducedMotion = useReducedMotion();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  const [search, setSearch] = useState("");

  // Bumped by "Effacer les filtres" to remount FilterBar: the search box holds
  // its own debounced input state, and clearing the page's `search` alone
  // would leave the text sitting in a field that no longer filters anything.
  const [filterResetKey, setFilterResetKey] = useState(0);

  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  // What the period holds with the other filters dropped, and the span of the
  // whole ledger: between them, an empty list can say which of the three
  // reasons it is empty for.
  const [periodTotal, setPeriodTotal] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<BackfillNotice | null>(null);

  const itemsRef = useRef<Transaction[]>(items);
  itemsRef.current = items;

  // Reference data (accounts, categories) loads once; every consumer below
  // (FilterBar, TransactionRow, the category filter) reads from these two
  // lists rather than fetching its own copy.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [accountList, categoryList] = await Promise.all([
          api.get<Account[]>("/accounts"),
          api.get<Category[]>("/categories"),
        ]);
        if (cancelled) return;
        setAccounts(accountList);
        setCategories(categoryList);
      } catch (err) {
        if (cancelled) return;
        setReferenceError(messageFor(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Every filter resets the page back to the top -- offset 0, replacing (not
  // appending to) whatever was on screen before.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const page = await api.get<TransactionPageBody>("/transactions", {
          date_from: period.from,
          date_to: period.to,
          account_id: accountId,
          category_id: categoryId,
          uncategorized_only: uncategorizedOnly,
          search,
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setPeriodTotal(page.period_total);
        setHistory(page.history);
      } catch (err) {
        if (cancelled) return;
        setLoadError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to, accountId, categoryId, uncategorizedOnly, search]);

  async function loadMore() {
    setIsLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api.get<TransactionPageBody>("/transactions", {
        date_from: period.from,
        date_to: period.to,
        account_id: accountId,
        category_id: categoryId,
        uncategorized_only: uncategorizedOnly,
        search,
        limit: PAGE_SIZE,
        offset: itemsRef.current.length,
      });
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      setLoadError(messageFor(err));
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleRecategorize(transactionId: number, categoryId: number | null) {
    const before = itemsRef.current.find((candidate) => candidate.id === transactionId);
    const previousCategoryId = before?.category_id ?? null;
    try {
      const updated = await api.patch<TransactionPatchResult>(`/transactions/${transactionId}`, {
        category_id: categoryId,
      });
      setItems((current) => current.map((t) => (t.id === transactionId ? updated : t)));
      setPatchError(null);
      setNotice(
        updated.backfilled > 0
          ? { transactionId, previousCategoryId, count: updated.backfilled, origin: "correction" }
          : null,
      );
    } catch (err) {
      setPatchError(messageFor(err));
    }
  }

  async function handleUndo() {
    if (!notice || notice.previousCategoryId === null) return;
    try {
      const updated = await api.patch<TransactionPatchResult>(
        `/transactions/${notice.transactionId}`,
        { category_id: notice.previousCategoryId },
      );
      setItems((current) => current.map((t) => (t.id === notice.transactionId ? updated : t)));
      setPatchError(null);
      // The undo is its own category change, so it can trigger its own learn
      // + backfill (see the module doc comment above) -- report that instead
      // of discarding it. Deliberately a distinct, Annuler-less notice: see
      // the doc comment for why this one doesn't chain into another undo.
      setNotice(
        updated.backfilled > 0
          ? {
              transactionId: notice.transactionId,
              previousCategoryId: null,
              count: updated.backfilled,
              origin: "undo",
            }
          : null,
      );
    } catch (err) {
      setPatchError(messageFor(err));
    }
  }

  const uncategorizedCount = uncategorizedOnly ? total : null;

  function clearFilters() {
    setAccountId(null);
    setCategoryId(null);
    setUncategorizedOnly(false);
    setSearch("");
    setFilterResetKey((key) => key + 1);
  }

  const filterLabels = activeFilterLabels({
    search,
    accountName: accounts.find((a) => a.id === accountId)?.name ?? null,
    categoryName: categories.find((c) => c.id === categoryId)?.name ?? null,
    uncategorizedOnly,
  });

  // Three reasons a list comes back empty, in the order that makes the answer
  // useful: no ledger at all beats an empty period, and an empty period beats
  // blaming a filter -- clearing a filter cannot conjure transactions into a
  // window that holds none.
  let emptyState: ReactNode = null;
  if (items.length === 0 && !isLoading) {
    if (history === null) {
      emptyState = (
        <EmptyState
          title="Aucune donnée pour le moment."
          detail="Importez un relevé bancaire pour voir vos opérations apparaître ici."
        >
          <Link to="/import" className="yd-empty__action">
            Importer un relevé
          </Link>
        </EmptyState>
      );
    } else if (periodTotal === 0) {
      emptyState = (
        <EmptyState
          title="Aucune transaction sur cette période."
          detail={historySentence(history)}
        >
          <button
            type="button"
            className="yd-empty__action"
            onClick={() => period.setRange(history.date_from, history.date_to)}
          >
            Afficher toute la période
          </button>
        </EmptyState>
      );
    } else {
      emptyState = (
        <EmptyState
          title="Aucune transaction ne correspond à ces filtres."
          detail={filteredEmptyDetail(periodTotal, filterLabels)}
        >
          <button type="button" className="yd-empty__action" onClick={clearFilters}>
            Effacer les filtres
          </button>
        </EmptyState>
      );
    }
  }

  return (
    <section className="yd-transactions">
      <PageHead icon={TransactionsIcon} title="Transactions">
        <p>
          Chaque opération importée, sur la période de votre choix. Corrigez une catégorie
          et Yieldo la retient pour les suivantes.
        </p>
      </PageHead>

      {referenceError ? (
        <p role="alert" className="yd-transactions__alert">
          {referenceError}
        </p>
      ) : null}

      {loadError ? (
        <p role="alert" className="yd-transactions__alert">
          {loadError}
        </p>
      ) : null}
      {patchError ? (
        <p role="alert" className="yd-transactions__alert">
          {patchError}
        </p>
      ) : null}

      {notice?.origin === "correction" ? (
        <div role="status" className="yd-transactions__notice">
          <p>
            Règle apprise — {notice.count}{" "}
            {plural(
              notice.count,
              "autre transaction similaire a été reclassée",
              "autres transactions similaires ont été reclassées",
            )}
            .
          </p>
          {notice.previousCategoryId !== null ? (
            <>
              <button type="button" className="yd-transactions__undo" onClick={() => void handleUndo()}>
                Annuler
              </button>
              <p className="yd-transactions__notice-hint">
                Cela restaure uniquement cette transaction à sa catégorie précédente ;{" "}
                {plural(
                  notice.count,
                  "la transaction reclassée automatiquement ne peut pas être annulée",
                  `les ${notice.count} transactions reclassées automatiquement ne peuvent pas être annulées`,
                )}{" "}
                individuellement.
              </p>
            </>
          ) : (
            <p className="yd-transactions__notice-hint">
              Cette transaction n'avait pas de catégorie avant cette correction : l'action ne peut pas
              être annulée.
            </p>
          )}
        </div>
      ) : null}

      {notice?.origin === "undo" ? (
        <div role="status" className="yd-transactions__notice">
          <p>
            Annulation effectuée — restaurer la catégorie précédente a aussi appris une règle qui a
            reclassé automatiquement {notice.count}{" "}
            {plural(notice.count, "autre transaction similaire", "autres transactions similaires")}.
          </p>
          <p className="yd-transactions__notice-hint">
            Cette reclassification automatique ne peut pas être annulée depuis cet écran.
          </p>
        </div>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reducedMotion)}>
        <BentoCell
          as={motion.div}
          span={SPAN.filters}
          className="yd-transactions__filters"
          {...entryProps(reducedMotion)}
        >
          <FilterBar
            key={filterResetKey}
            period={period}
            accounts={accounts}
            categories={categories}
            accountId={accountId}
            onAccountChange={setAccountId}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            uncategorizedOnly={uncategorizedOnly}
            onUncategorizedOnlyChange={setUncategorizedOnly}
            uncategorizedCount={uncategorizedCount}
            onSearchChange={setSearch}
          />
        </BentoCell>

        {/* The cells are what arrives, never the rows: two hundred staggered
            table rows is a slot machine, not an interface. */}
        <BentoCell
          as={motion.div}
          span={SPAN.list}
          rows={LIST_ROWS}
          className="yd-transactions__list"
          {...entryProps(reducedMotion)}
        >
          {emptyState !== null ? (
            <div className="yd-transactions__empty">{emptyState}</div>
          ) : (
            <>
              <div className="yd-transactions__scroll">
                {/* The roles are written down rather than inferred from the
                    layout: under 600px TransactionsPage.css lays each row out
                    as a two-line grid, which means these boxes stop being
                    table boxes and a browser stops exposing them as a table.
                    Declaring the roles keeps the list a table at every width. */}
                <table className="yd-transactions__table" role="table">
                  <thead className="yd-transactions__head" role="rowgroup">
                    <tr role="row">
                      <th scope="col" role="columnheader">
                        Date
                      </th>
                      <th scope="col" role="columnheader">
                        Libellé
                      </th>
                      <th scope="col" role="columnheader">
                        Catégorie
                      </th>
                      <th scope="col" role="columnheader">
                        Montant
                      </th>
                    </tr>
                  </thead>
                  <tbody className="yd-transactions__body" role="rowgroup">
                    {items.map((transaction) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        categories={categories}
                        onRecategorize={(id, catId) => void handleRecategorize(id, catId)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="yd-transactions__footer">
                <span>
                  {items.length} sur {total} {plural(total, "transaction", "transactions")}
                </span>
                {items.length < total ? (
                  <button
                    type="button"
                    className="yd-transactions__load-more"
                    onClick={() => void loadMore()}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? "Chargement…" : "Charger plus"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
