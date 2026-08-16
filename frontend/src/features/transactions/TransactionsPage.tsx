import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { ApiError, api } from "../../lib/api";
import type {
  Account,
  Category,
  Transaction,
  TransactionPage as TransactionPageBody,
  TransactionPatchResult,
} from "../../lib/types";
import { FilterBar } from "./FilterBar";
import { TransactionRow } from "./TransactionRow";
import "./TransactionsPage.css";
import { usePeriod } from "./usePeriod";

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

function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular;
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

  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
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

  return (
    <section className="yd-transactions">
      <h1>Transactions</h1>

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
            Règle apprise — {notice.count} {plural(notice.count, "autre transaction similaire a été", "autres transactions similaires ont été")} reclassée{notice.count > 1 ? "s" : ""}.
          </p>
          {notice.previousCategoryId !== null ? (
            <>
              <button type="button" className="yd-transactions__undo" onClick={() => void handleUndo()}>
                Annuler
              </button>
              <p className="yd-transactions__notice-hint">
                Cela restaure uniquement cette transaction à sa catégorie précédente ; les{" "}
                {notice.count} transactions reclassées automatiquement ne peuvent pas être annulées
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
          {items.length === 0 && !isLoading ? (
            <div className="yd-transactions__empty">
              <p>Aucune transaction ne correspond à ces filtres.</p>
              <Link to="/import" className="yd-transactions__empty-cta">
                Importer un relevé
              </Link>
            </div>
          ) : (
            <>
              <div className="yd-transactions__scroll">
                <table className="yd-transactions__table">
                  <thead className="yd-transactions__head">
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Libellé</th>
                      <th scope="col">Catégorie</th>
                      <th scope="col">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
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
                  {items.length} sur {total} transaction{total > 1 ? "s" : ""}
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
