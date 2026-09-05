import { useEffect, useState, type FormEvent } from "react";

import { Drawer } from "../../design/Drawer";
import { EditIcon, PlusIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import type { Account, Category, Transaction } from "../../lib/types";
import { CategoryPicker } from "./CategoryPicker";
import "./TransactionForm.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * Euros typed by a person, as integer cents.
 *
 * Never `parseFloat`: `12.10 * 100` is 1209.9999999999998, and a rounding step
 * papering over that is a float on a monetary value with an extra line of
 * arithmetic in front of it. The two halves are read as the integers they are.
 * Returns null for anything that is not a plain positive amount — the sign is
 * carried by the direction control, not typed into this field.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  return cents > 0 ? cents : null;
}

/** The other direction: stored cents, back into the field a person types in.
 *  Unsigned, because the sign lives on the direction control -- reading a
 *  stored -1250 back as "-12,50" would put a minus sign in a field that
 *  refuses one. */
export function centsToAmountInput(cents: number): string {
  const absolute = Math.abs(cents);
  return `${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

/** A date the reader has finished writing, as opposed to one they are halfway
 *  through. `<input type="date">` reports a value for every keystroke that
 *  leaves the field parseable, so the first digit of the year is the perfectly
 *  valid year 2 -- and saving that writes a transaction dated 0002 without a
 *  word. The same guard PeriodSelector applies to the custom range, here on
 *  the way out instead of on the way in: the field stays as forgiving to type
 *  in as it was, and only the save is held back. */
export function isCompleteDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000;
}

/** Today, in the ISO form the date input and the API both speak. */
export function todayIso(today: Date = new Date()): string {
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

type Direction = "expense" | "income";

interface TransactionFormProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
  /** Called with the row once the ledger has accepted it -- created or
   *  corrected, since the caller reloads the same way either way. */
  onSaved: (saved: Transaction) => void;
  /** The row being corrected, or null to write a new one. */
  transaction?: Transaction | null;
  today?: Date;
}

/**
 * One operation, typed in by hand.
 *
 * A statement is not a household's only source of truth: cash, a purchase made
 * before the statement arrives, a reimbursement between two people. This is
 * the way in for those, and what it writes is an ordinary ledger row — same
 * table, same categorisation — distinguished only by having no import behind
 * it.
 *
 * The amount is asked for as a positive number beside a direction, not as a
 * signed figure. "-12,50" is a convention; "Dépense, 12,50 €" is a sentence,
 * and a missing minus sign is the single easiest way to enter a purchase as
 * income without noticing.
 *
 * The category may be left alone: the backend then runs the household's own
 * rules over the label, exactly as an import would. The field says so.
 */
export function TransactionForm({
  open,
  onClose,
  accounts,
  categories,
  onSaved,
  transaction = null,
  today = new Date(),
}: TransactionFormProps) {
  const editing = transaction !== null;
  const [date, setDate] = useState(transaction?.date ?? todayIso(today));
  const [direction, setDirection] = useState<Direction>(
    transaction !== null && transaction.amount_cents > 0 ? "income" : "expense",
  );
  const [amount, setAmount] = useState(
    transaction === null ? "" : centsToAmountInput(transaction.amount_cents),
  );
  const [label, setLabel] = useState(transaction?.label_raw ?? "");
  const [accountId, setAccountId] = useState<number | null>(
    transaction?.account_id ?? accounts[0]?.id ?? null,
  );
  const [categoryId, setCategoryId] = useState<number | null>(transaction?.category_id ?? null);
  const [notes, setNotes] = useState(transaction?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = parseAmountToCents(amount);
  const effectiveAccountId = accountId ?? accounts[0]?.id ?? null;

  function reset() {
    setDate(transaction?.date ?? todayIso(today));
    setDirection(transaction !== null && transaction.amount_cents > 0 ? "income" : "expense");
    setAmount(transaction === null ? "" : centsToAmountInput(transaction.amount_cents));
    setLabel(transaction?.label_raw ?? "");
    setAccountId(transaction?.account_id ?? accounts[0]?.id ?? null);
    setCategoryId(transaction?.category_id ?? null);
    setNotes(transaction?.notes ?? "");
    setError(null);
  }

  // The drawer is mounted once and pointed at a different row each time it
  // opens, so the fields are refilled on open rather than on mount: a state
  // initialiser runs only for the first row this component ever saw.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [open, transaction?.id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (effectiveAccountId === null) {
      setError("Aucun compte n'est déclaré : créez-en un dans Réglages → Comptes.");
      return;
    }
    if (cents === null) {
      setError("Le montant doit être un nombre positif, avec au plus deux décimales.");
      return;
    }
    if (label.trim() === "") {
      setError("Le libellé est obligatoire.");
      return;
    }
    if (!isCompleteDate(date)) {
      setError("La date est incomplète : indiquez le jour, le mois et l'année sur quatre chiffres.");
      return;
    }

    const common = {
      account_id: effectiveAccountId,
      date,
      amount_cents: direction === "expense" ? -cents : cents,
      label_raw: label.trim(),
      notes: notes.trim() === "" ? null : notes.trim(),
    };

    setSaving(true);
    try {
      let saved: Transaction;
      if (transaction !== null) {
        // The category is sent ONLY when the reader moved it. The backend reads
        // any category_id as a correction: it learns a rule from it and
        // backfills every similar row. Fixing a date must not reclassify a
        // household's ledger as a side effect.
        const patch: Record<string, unknown> = { ...common };
        if (categoryId !== transaction.category_id) patch.category_id = categoryId;
        saved = await api.patch<Transaction>(`/transactions/${transaction.id}`, patch);
      } else {
        saved = await api.post<Transaction>("/transactions", {
          ...common,
          category_id: categoryId,
        });
      }
      onSaved(saved);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? "Modifier une opération" : "Ajouter une opération"}
      icon={editing ? EditIcon : PlusIcon}
      subtitle={
        editing
          ? "Une date, un montant, un libellé : corrigez la ligne telle qu'elle aurait dû être écrite."
          : "Un achat en espèces, une avance, un remboursement — tout ce qu'aucun relevé ne portera."
      }
    >
      <form className="yd-txform" onSubmit={handleSubmit}>
        <div className="yd-txform__field">
          <label htmlFor="yd-txform-date">Date</label>
          <input
            id="yd-txform-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>

        <fieldset className="yd-txform__direction">
          <legend>Sens</legend>
          <div className="yd-txform__direction-options">
            <label htmlFor="yd-txform-expense">
              <input
                id="yd-txform-expense"
                type="radio"
                name="yd-txform-direction"
                value="expense"
                checked={direction === "expense"}
                onChange={() => setDirection("expense")}
              />
              <span>Dépense</span>
            </label>
            <label htmlFor="yd-txform-income">
              <input
                id="yd-txform-income"
                type="radio"
                name="yd-txform-direction"
                value="income"
                checked={direction === "income"}
                onChange={() => setDirection("income")}
              />
              <span>Recette</span>
            </label>
          </div>
        </fieldset>

        <div className="yd-txform__field">
          <label htmlFor="yd-txform-amount">Montant (€)</label>
          <input
            id="yd-txform-amount"
            type="text"
            inputMode="decimal"
            className="yd-num"
            placeholder="12,50"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={amount !== "" && cents === null}
            required
          />
        </div>

        <div className="yd-txform__field">
          <label htmlFor="yd-txform-label">Libellé</label>
          <input
            id="yd-txform-label"
            type="text"
            placeholder="Boulangerie du coin"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </div>

        <div className="yd-txform__field">
          <label htmlFor="yd-txform-account">Compte</label>
          <select
            id="yd-txform-account"
            value={effectiveAccountId ?? ""}
            onChange={(event) => setAccountId(Number(event.target.value))}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        <div className="yd-txform__field">
          {/* CategoryPicker carries its own sr-only label -- this caption is
              the visible one, so the field is not the only one on the form
              without a heading over it. A bare span is not a label element,
              so nothing is announced twice. */}
          <span className="yd-txform__caption" aria-hidden="true">
            Catégorie
          </span>
          <CategoryPicker
            value={categoryId}
            onChange={setCategoryId}
            categories={categories}
            label="Catégorie"
            placeholder={editing ? "Aucune catégorie" : "Détecter automatiquement"}
            resetLabel={editing ? "Aucune catégorie" : "Détecter automatiquement"}
          />
        </div>

        <div className="yd-txform__field">
          <label htmlFor="yd-txform-notes">Note (facultative)</label>
          <input
            id="yd-txform-notes"
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <p className="yd-txform__note">
          {editing
            ? "La ligne est corrigée telle quelle. La catégorie n'est renvoyée que si vous la changez : Yieldo n'apprend une règle que d'une correction voulue."
            : "Sans catégorie choisie, vos propres règles de catégorisation sont appliquées au libellé, comme lors d'un import."}
        </p>

        {error !== null ? (
          <p className="yd-txform__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="yd-txform__actions">
          <button type="submit" className="yd-txform__save" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="yd-txform__cancel" onClick={onClose} disabled={saving}>
            Annuler
          </button>
        </div>
      </form>
    </Drawer>
  );
}
