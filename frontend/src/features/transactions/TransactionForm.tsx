import { useState, type FormEvent } from "react";

import { Drawer } from "../../design/Drawer";
import { PlusIcon } from "../../design/icons";
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
  /** Called with the created row once the ledger has accepted it. */
  onCreated: (created: Transaction) => void;
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
  onCreated,
  today = new Date(),
}: TransactionFormProps) {
  const [date, setDate] = useState(todayIso(today));
  const [direction, setDirection] = useState<Direction>("expense");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [accountId, setAccountId] = useState<number | null>(accounts[0]?.id ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = parseAmountToCents(amount);
  const effectiveAccountId = accountId ?? accounts[0]?.id ?? null;

  function reset() {
    setDate(todayIso(today));
    setDirection("expense");
    setAmount("");
    setLabel("");
    setCategoryId(null);
    setNotes("");
    setError(null);
  }

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

    setSaving(true);
    try {
      const created = await api.post<Transaction>("/transactions", {
        account_id: effectiveAccountId,
        date,
        amount_cents: direction === "expense" ? -cents : cents,
        label_raw: label.trim(),
        category_id: categoryId,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      onCreated(created);
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
      title="Ajouter une opération"
      icon={PlusIcon}
      subtitle="Un achat en espèces, une avance, un remboursement — tout ce qu'aucun relevé ne portera."
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
            placeholder="Détecter automatiquement"
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
          Sans catégorie choisie, vos propres règles de catégorisation sont appliquées au libellé,
          comme lors d'un import.
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
