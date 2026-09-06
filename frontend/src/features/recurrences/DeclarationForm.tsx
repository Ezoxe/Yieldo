import { useId, useState, type FormEvent } from "react";

import { centsToInput, parseCents } from "../../design/theme";
import type {
  DeclaredPeriodicity,
  DeclaredRecurrence,
  Category,
  Account,
} from "../../lib/types";
import { DECLARED_PERIODICITIES } from "../../lib/types";

/** `engines/recurrence.PERIODS`, in this screen's French. */
export const PERIODICITY_OPTIONS: Record<DeclaredPeriodicity, string> = {
  weekly: "Chaque semaine",
  biweekly: "Toutes les deux semaines",
  monthly: "Chaque mois",
  quarterly: "Chaque trimestre",
  yearly: "Chaque année",
};

/**
 * What the form sends. `amount_cents` is signed, and the sign comes from the
 * direction control rather than from a minus the reader has to remember to
 * type: "Une dépense" / "Un revenu" is a question anyone can answer, "-15,99"
 * is a convention only this codebase knows.
 */
export interface DeclarationDraft {
  label: string;
  amount_cents: number;
  amount_is_variable: boolean;
  periodicity: DeclaredPeriodicity;
  anchor_on: string;
  ends_on: string | null;
  category_id: number | null;
  account_id: number | null;
  notes: string | null;
}

type FieldName = "label" | "amount" | "anchor" | "ends";
type Errors = Partial<Record<FieldName, string>>;

interface DeclarationFormProps {
  /** The declaration being corrected, or null for a new one. */
  initial: DeclaredRecurrence | null;
  categories: Category[];
  accounts: Account[];
  busy: boolean;
  onSubmit: (draft: DeclarationDraft) => void;
  onCancel: () => void;
}

/** Today, in the `YYYY-MM-DD` the date input and the API both speak. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function DeclarationForm({
  initial,
  categories,
  accounts,
  busy,
  onSubmit,
  onCancel,
}: DeclarationFormProps) {
  const id = useId();
  const [label, setLabel] = useState(initial?.label ?? "");
  // The magnitude only. The sign is `direction`, below.
  const [amount, setAmount] = useState(
    initial ? centsToInput(Math.abs(initial.amount_cents)) : "",
  );
  const [direction, setDirection] = useState<"charge" | "income">(
    initial && initial.amount_cents > 0 ? "income" : "charge",
  );
  const [variable, setVariable] = useState(initial?.amount_is_variable ?? false);
  const [periodicity, setPeriodicity] = useState<DeclaredPeriodicity>(
    initial?.periodicity ?? "monthly",
  );
  const [anchor, setAnchor] = useState(initial?.anchor_on ?? todayIso());
  const [ends, setEnds] = useState(initial?.ends_on ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? null);
  const [accountId, setAccountId] = useState(initial?.account_id ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<Errors>({});

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};

    const trimmed = label.trim();
    if (!trimmed) next.label = "Donnez un nom à cette récurrence.";

    const magnitude = parseCents(amount);
    if (magnitude === null) {
      next.amount = "Montant illisible. Exemple : 15,99";
    } else if (magnitude === 0) {
      next.amount = "Le montant ne peut pas être nul.";
    }

    if (!anchor) next.anchor = "Indiquez la date de la première échéance.";
    if (ends && anchor && ends < anchor) {
      next.ends = "La fin ne peut pas précéder la première échéance.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0 || magnitude === null) return;

    onSubmit({
      label: trimmed,
      amount_cents: direction === "charge" ? -magnitude : magnitude,
      amount_is_variable: variable,
      periodicity,
      anchor_on: anchor,
      ends_on: ends || null,
      category_id: categoryId,
      account_id: accountId,
      notes: notes.trim() || null,
    });
  }

  const parents = categories.filter((candidate) => candidate.parent_id === null);

  return (
    <form className="yd-declaration-form" onSubmit={handleSubmit} noValidate>
      <label className="yd-declaration-form__field">
        <span>Nom</span>
        <input
          id={`${id}-label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Netflix, Loyer, Électricité…"
          aria-invalid={errors.label ? true : undefined}
        />
        {errors.label ? (
          <span className="yd-declaration-form__error">{errors.label}</span>
        ) : null}
      </label>

      {/* The sign, asked as a question rather than typed as a minus. A reader
          who forgets the minus declares a 950 EUR rent as income, and every
          total on the screen quietly inverts. */}
      <fieldset className="yd-declaration-form__field">
        <legend>Sens</legend>
        <div className="yd-declaration-form__choices">
          <label>
            <input
              type="radio"
              name={`${id}-direction`}
              checked={direction === "charge"}
              onChange={() => setDirection("charge")}
            />
            <span>Une dépense</span>
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-direction`}
              checked={direction === "income"}
              onChange={() => setDirection("income")}
            />
            <span>Un revenu</span>
          </label>
        </div>
      </fieldset>

      <label className="yd-declaration-form__field">
        <span>Montant</span>
        <input
          id={`${id}-amount`}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="15,99"
          aria-invalid={errors.amount ? true : undefined}
        />
        {errors.amount ? (
          <span className="yd-declaration-form__error">{errors.amount}</span>
        ) : null}
      </label>

      {/* Water, electricity, gas. What lets a bill be declared at all: the
          detection engine refuses a charge whose amount wanders, and this is
          the household saying "it wanders, and that is normal". */}
      <div className="yd-declaration-form__toggle">
        <label>
          <input
            type="checkbox"
            role="switch"
            checked={variable}
            aria-checked={variable}
            aria-describedby={`${id}-variable-hint`}
            onChange={(event) => setVariable(event.target.checked)}
          />
          <span>Le montant varie d'une échéance à l'autre</span>
        </label>
        <span className="yd-declaration-form__hint" id={`${id}-variable-hint`}>
          Eau, électricité, gaz. Le montant ci-dessus sert d'estimation jusqu'à ce que vous
          ayez pointé trois échéances ; ensuite Yieldo compte ce que vous avez réellement
          payé.
        </span>
      </div>

      <label className="yd-declaration-form__field">
        <span>Rythme</span>
        <select
          id={`${id}-periodicity`}
          value={periodicity}
          onChange={(event) =>
            setPeriodicity(event.target.value as DeclaredPeriodicity)
          }
        >
          {DECLARED_PERIODICITIES.map((value) => (
            <option key={value} value={value}>
              {PERIODICITY_OPTIONS[value]}
            </option>
          ))}
        </select>
      </label>

      {/* The hint sits OUTSIDE the label and is attached with
          `aria-describedby`: inside it, it becomes part of the control's
          accessible name, and "Première échéance" turns into a paragraph. */}
      <div className="yd-declaration-form__field">
        <label htmlFor={`${id}-anchor`}>Première échéance</label>
        <input
          id={`${id}-anchor`}
          type="date"
          value={anchor}
          onChange={(event) => setAnchor(event.target.value)}
          aria-describedby={`${id}-anchor-hint`}
          aria-invalid={errors.anchor ? true : undefined}
        />
        <span className="yd-declaration-form__hint" id={`${id}-anchor-hint`}>
          Toutes les échéances suivantes se calculent à partir de cette date.
        </span>
        {errors.anchor ? (
          <span className="yd-declaration-form__error">{errors.anchor}</span>
        ) : null}
      </div>

      <div className="yd-declaration-form__field">
        <label htmlFor={`${id}-ends`}>Fin (facultatif)</label>
        <input
          id={`${id}-ends`}
          type="date"
          value={ends}
          onChange={(event) => setEnds(event.target.value)}
          aria-describedby={`${id}-ends-hint`}
          aria-invalid={errors.ends ? true : undefined}
        />
        <span className="yd-declaration-form__hint" id={`${id}-ends-hint`}>
          Les échéances passées restent au calendrier ; le coût annuel, lui, s'arrête.
        </span>
        {errors.ends ? (
          <span className="yd-declaration-form__error">{errors.ends}</span>
        ) : null}
      </div>

      <label className="yd-declaration-form__field">
        <span>Catégorie (facultatif)</span>
        <select
          id={`${id}-category`}
          value={categoryId ?? ""}
          onChange={(event) =>
            setCategoryId(event.target.value === "" ? null : Number(event.target.value))
          }
        >
          <option value="">Aucune</option>
          {parents.map((parent) => (
            <optgroup key={parent.id} label={parent.name}>
              <option value={parent.id}>{parent.name}</option>
              {categories
                .filter((child) => child.parent_id === parent.id)
                .map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="yd-declaration-form__field">
        <span>Compte (facultatif)</span>
        <select
          id={`${id}-account`}
          value={accountId ?? ""}
          onChange={(event) =>
            setAccountId(event.target.value === "" ? null : Number(event.target.value))
          }
        >
          <option value="">Aucun</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <label className="yd-declaration-form__field">
        <span>Notes (facultatif)</span>
        <textarea
          id={`${id}-notes`}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <div className="yd-declaration-form__actions">
        <button type="button" className="yd-declaration-form__cancel" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="yd-declaration-form__submit" disabled={busy}>
          {busy ? "Enregistrement…" : initial ? "Enregistrer" : "Déclarer"}
        </button>
      </div>
    </form>
  );
}
