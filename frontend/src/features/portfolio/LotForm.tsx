import { useId, useState, type FormEvent } from "react";

import { centsToInput, formatQuantity, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Lot, LotIn } from "../../lib/types";
import { Field, FormActions, fieldAria } from "./formField";
import { parseQuantity, quantityToInput, sumQuantities } from "./quantity";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

type FieldName = "quantity" | "cost" | "acquired";

/**
 * "unité" or "unités", agreeing with a quantity that is a STRING.
 *
 * The integer part alone decides it, read as an integer — French takes the
 * singular below two, so 0,3 is "0,3 unité" and 20 is "20 unités". Never
 * `Number(theWholeQuantity)`: a float cannot hold eighteen decimals, and this
 * helper has no business being the place one gets built.
 */
function units(quantity: string): string {
  const [whole = "0"] = quantity.split(".");
  return plural(Number(whole), "unité", "unités");
}

interface LotFormProps {
  positionId: number;
  /** The instrument this position holds — named in the running total, so the
   *  sentence says WHICH position the figure belongs to. */
  symbol: string;
  /** Absent for a new acquisition; the lot being amended otherwise. */
  lot?: Lot;
  /** Every lot the position already holds, the one being amended included:
   *  the form filters itself out, so amending never counts a lot twice. */
  siblings: Lot[];
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * One acquisition: a quantity, the unit price actually paid, and the date.
 *
 * **This form is where "a position is the sum of its lots" becomes visible.**
 * `models/position.py` stores no total, and the reason is not tidiness: the
 * per-lot French capital-gains computation needs each acquisition's own
 * quantity, price and date, and a stored total would have destroyed all three.
 * So the form prints the total it is about to produce — `n lots, soit x unités`
 * — recomputed as the household types, and says outright that nothing of the
 * sort is stored.
 *
 * **A quantity is not money.** It goes through {@link parseQuantity} (an
 * 18-decimal `Decimal` carried as a string, refused rather than truncated past
 * that scale) and renders through `formatQuantity`. The unit cost beside it IS
 * money and goes through `parseCents`. The two fields sit side by side on
 * purpose: the difference between them is the whole discipline.
 */
export function LotForm({ positionId, symbol, lot, siblings, onSaved, onCancel }: LotFormProps) {
  const baseId = useId();
  const [quantity, setQuantity] = useState(lot ? quantityToInput(lot.quantity) : "");
  const [cost, setCost] = useState(lot ? centsToInput(lot.unit_cost_cents) : "");
  const [acquiredOn, setAcquiredOn] = useState(lot?.acquired_on ?? "");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldId = (field: FieldName) => `${baseId}-${field}`;

  function clearField(field: FieldName) {
    setFieldErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  // Every OTHER lot of this position: the one being amended is replaced by
  // what is in the field, never added to it.
  const others = siblings.filter((entry) => entry.id !== lot?.id);
  const typed = parseQuantity(quantity);

  /**
   * The derived total, in the tense that is true of the current field.
   *
   * Three states, three sentences, because they are three different facts: an
   * empty field has produced nothing yet and the position holds what it holds;
   * a readable one lets the sum be shown BEFORE it is saved; an unreadable one
   * has no total at all, and inventing one — the old figure, or a zero — would
   * be a number nobody computed.
   */
  function runningTotal(): string {
    if (quantity.trim().length === 0) {
      if (others.length === 0) {
        return `${symbol} ne compte encore aucun lot : celui-ci sera le premier, et c'est lui qui donnera sa quantité à la position.`;
      }
      const held = sumQuantities(others.map((entry) => entry.quantity));
      return `${symbol} détient aujourd'hui ${formatQuantity(held)} ${units(held)}, somme de ses ${others.length} ${plural(others.length, "lot", "lots")}. Le lot déclaré ici s'y ajoutera.`;
    }
    if ("error" in typed) {
      return "Le total ne peut pas être calculé tant que la quantité saisie n'est pas lisible.";
    }
    const total = sumQuantities([...others.map((entry) => entry.quantity), typed.quantity]);
    const count = others.length + 1;
    return `Après enregistrement, ${symbol} comptera ${count} ${plural(count, "lot", "lots")}, soit ${formatQuantity(total)} ${units(total)} au total.`;
  }

  function validate(): { payload: LotIn } | { errors: Partial<Record<FieldName, string>> } {
    const errors: Partial<Record<FieldName, string>> = {};

    // The quantity's own refusal, verbatim: `parseQuantity` names which of four
    // things is wrong with what was typed, and each has a different remedy.
    if ("error" in typed) errors.quantity = typed.error;

    const costCents = parseCents(cost);
    if (costCents === null) {
      errors.cost = "Prix illisible : saisissez le prix unitaire payé en euros, par exemple 150,00.";
    } else if (costCents < 0) {
      errors.cost =
        "Le prix unitaire payé ne peut pas être négatif : c'est une somme réglée, pas un mouvement.";
    }

    if (acquiredOn.length === 0) {
      errors.acquired =
        "Date d'acquisition manquante : c'est elle qui datera la plus-value de ce lot, lot par lot.";
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(acquiredOn)) {
      errors.acquired = "Date illisible : attendue au format AAAA-MM-JJ.";
    }

    if (Object.keys(errors).length > 0) return { errors };
    return {
      payload: {
        position_id: positionId,
        quantity: (typed as { quantity: string }).quantity,
        unit_cost_cents: costCents as number,
        acquired_on: acquiredOn,
      },
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate();
    if ("errors" in result) {
      setFieldErrors(result.errors);
      setFormError(null);
      return;
    }
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      if (lot) {
        // `position_id` is deliberately not patchable (`schemas.LotPatch`):
        // moving a lot to another position is a new acquisition record, not an
        // edit of this one.
        const { position_id: _unused, ...patch } = result.payload;
        await api.patch(`/portfolio/lots/${lot.id}`, patch);
      } else {
        await api.post("/portfolio/lots", result.payload);
      }
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="yd-pform" onSubmit={submit} noValidate>
      <h4 className="yd-pform__title">
        {lot ? `Modifier le lot du ${lot.acquired_on}` : `Nouveau lot sur ${symbol}`}
      </h4>

      <Field id={fieldId("quantity")} label="Quantité acquise" error={fieldErrors.quantity}>
        <input
          {...fieldAria(fieldId("quantity"), fieldErrors.quantity)}
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={(event) => {
            setQuantity(event.target.value);
            clearField("quantity");
          }}
          placeholder="12"
        />
      </Field>

      <Field id={fieldId("cost")} label="Prix unitaire payé (€)" error={fieldErrors.cost}>
        <input
          {...fieldAria(fieldId("cost"), fieldErrors.cost)}
          type="text"
          inputMode="decimal"
          value={cost}
          onChange={(event) => {
            setCost(event.target.value);
            clearField("cost");
          }}
          placeholder="150,00"
        />
      </Field>

      <Field id={fieldId("acquired")} label="Date d'acquisition" error={fieldErrors.acquired}>
        <input
          {...fieldAria(fieldId("acquired"), fieldErrors.acquired)}
          type="date"
          value={acquiredOn}
          onChange={(event) => {
            setAcquiredOn(event.target.value);
            clearField("acquired");
          }}
        />
      </Field>

      <p className="yd-pform__derived" data-testid="yd-lot-running-total">
        {runningTotal()}
      </p>

      <p className="yd-pform__note">
        Yieldo ne stocke jamais ce total : il est recalculé à partir des lots à chaque affichage.
        C'est ce qui rendra possible le calcul des plus-values lot par lot, chaque acquisition
        gardant sa propre date et son propre prix.
      </p>

      {formError !== null ? (
        <p role="alert" className="yd-pform__error yd-pform__error--form">
          {formError}
        </p>
      ) : null}

      <FormActions saving={saving} onCancel={onCancel} />
    </form>
  );
}
