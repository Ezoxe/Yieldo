import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { GlassCard } from "../../design/glass/GlassCard";
import { staggerChildren } from "../../design/motion/variants";
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

      <GlassCard tone="solid" className="yd-transactions__panel">
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
                {reducedMotion ? (
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
                ) : (
                  <motion.tbody variants={staggerChildren} initial="hidden" animate="visible">
                    {items.map((transaction) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        categories={categories}
                        onRecategorize={(id, catId) => void handleRecategorize(id, catId)}
                      />
                    ))}
                  </motion.tbody>
                )}
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
      </GlassCard>
    </section>
  );
}
