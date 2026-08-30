import { useId, useState, type FormEvent, type ReactNode } from "react";

import { centsToInput, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { GoalIn, GoalProgress } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** `schemas.GoalIn.priority`: `ge=1, le=999`. */
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 999;

interface GoalFormProps {
  /**
   * The row being amended, absent for a creation.
   *
   * This is `GoalProgress` and not `Goal` because `GET /api/goals` returns
   * `GoalReportOut`, whose rows are `GoalProgressOut` — and that shape carries
   * **no `priority`**. The screen therefore has no way to prefill that one
   * field, which is why it starts empty and is omitted from the patch unless
   * the user fills it in. Sending a made-up default would silently re-rank the
   * funding queue.
   */
  goal?: GoalProgress;
  onSaved: () => void;
  onCancel: () => void;
}

type FieldName = "name" | "target" | "saved" | "due" | "priority";

/**
 * Add or amend one goal.
 *
 * Every euro field goes through `parseCents` — string arithmetic, and `null`
 * rather than 0 on anything it cannot read exactly, so an unreadable amount can
 * never be saved as nothing.
 *
 * Field errors render **at the field**, with `aria-invalid` and
 * `aria-describedby`. Sent to a page-level alert instead they land above the
 * bento grid, which at 375px is several screens above the input.
 */
export function GoalForm({ goal, onSaved, onCancel }: GoalFormProps) {
  const baseId = useId();
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? centsToInput(goal.target_cents) : "");
  // "0" rather than "": most goals start from nothing, and the backend's own
  // default for `saved_cents` is 0. An emptied field means the same thing —
  // this is the one amount on the screen whose absence genuinely IS zero.
  const [saved, setSaved] = useState(goal ? centsToInput(goal.saved_cents) : "0");
  const [dueOn, setDueOn] = useState(goal?.due_on ?? "");
  const [priority, setPriority] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldId = (field: FieldName) => `${baseId}-${field}`;
  const errorId = (field: FieldName) => `${baseId}-${field}-error`;

  function clearField(field: FieldName) {
    // What was typed is what was rejected; once it changes, the message no
    // longer describes the field it sits under.
    setFieldErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /** Everything the form knows, or the reasons it knows nothing usable. */
  function validate():
    | { payload: Partial<GoalIn> }
    | { errors: Partial<Record<FieldName, string>> } {
    const errors: Partial<Record<FieldName, string>> = {};

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      errors.name = "Donnez un intitulé à cet objectif, par exemple « Fonds d'urgence ».";
    }

    const targetCents = parseCents(target);
    if (targetCents === null) {
      errors.target = "Montant illisible : saisissez un montant en euros, par exemple 6 000,00.";
    } else if (targetCents <= 0) {
      errors.target =
        "Le montant visé doit être strictement positif : un objectif de 0 € n'a rien à atteindre.";
    }

    // An emptied field is zero here, and only here. Anything typed still has to
    // parse exactly.
    const savedText = saved.trim();
    const savedCents = savedText.length === 0 ? 0 : parseCents(savedText);
    if (savedCents === null) {
      errors.saved = "Montant illisible : saisissez un montant en euros, par exemple 1 200,00.";
    } else if (savedCents < 0) {
      errors.saved =
        "Le montant déjà mis de côté ne peut pas être négatif : c'est une somme détenue, pas un mouvement.";
    }

    if (dueOn.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
      errors.due = "Date illisible : attendue au format AAAA-MM-JJ.";
    }

    let priorityValue: number | null = null;
    const priorityText = priority.trim();
    if (priorityText.length > 0) {
      if (!/^\d+$/.test(priorityText)) {
        errors.priority = `Priorité illisible : saisissez un nombre entier entre ${MIN_PRIORITY} et ${MAX_PRIORITY}.`;
      } else {
        priorityValue = Number(priorityText);
        if (priorityValue < MIN_PRIORITY || priorityValue > MAX_PRIORITY) {
          errors.priority = `La priorité doit tenir entre ${MIN_PRIORITY} et ${MAX_PRIORITY}.`;
        }
      }
    }

    if (Object.keys(errors).length > 0) return { errors };

    const payload: Partial<GoalIn> = {
      name: trimmed,
      target_cents: targetCents as number,
      saved_cents: savedCents as number,
      // Explicitly null, never "": the wire type is `date | None` and an empty
      // string is a 422. Clearing a deadline is a legitimate edit.
      due_on: dueOn.length > 0 ? dueOn : null,
    };
    // Omitted when blank so a PATCH leaves the rank it cannot show untouched,
    // and a POST falls through to the backend's own default.
    if (priorityValue !== null) payload.priority = priorityValue;
    return { payload };
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
      if (goal) await api.patch(`/goals/${goal.goal_id}`, result.payload);
      else await api.post("/goals", result.payload);
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  function field(
    which: FieldName,
    label: string,
    input: (props: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby": string | undefined;
    }) => ReactNode,
  ) {
    const message = fieldErrors[which];
    return (
      <div className="yd-goal-form__field">
        <label htmlFor={fieldId(which)}>{label}</label>
        {input({
          id: fieldId(which),
          "aria-invalid": message !== undefined,
          "aria-describedby": message !== undefined ? errorId(which) : undefined,
        })}
        {message !== undefined ? (
          <p id={errorId(which)} role="alert" className="yd-goal-form__error">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="yd-goal-form" onSubmit={submit} noValidate>
      <h3 className="yd-goal-form__title">
        {goal ? `Modifier « ${goal.name} »` : "Nouvel objectif"}
      </h3>

      {field("name", "Intitulé", (props) => (
        <input
          {...props}
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            clearField("name");
          }}
          placeholder="Fonds d'urgence"
        />
      ))}

      {field("target", "Montant visé (€)", (props) => (
        <input
          {...props}
          type="text"
          inputMode="decimal"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            clearField("target");
          }}
          placeholder="6 000,00"
        />
      ))}

      {field("saved", "Déjà mis de côté (€)", (props) => (
        <input
          {...props}
          type="text"
          inputMode="decimal"
          value={saved}
          onChange={(event) => {
            setSaved(event.target.value);
            clearField("saved");
          }}
          placeholder="0,00"
        />
      ))}

      {field("due", "Échéance (facultative)", (props) => (
        <input
          {...props}
          type="date"
          value={dueOn}
          onChange={(event) => {
            setDueOn(event.target.value);
            clearField("due");
          }}
        />
      ))}

      {/* The scale is named in the label itself. "Priorité 2" means nothing on
          its own, and the entire funding queue — one goal at a time — hangs off
          this number. A text input rather than `type="number"`: the same choice
          DebtForm made for its month count, so an empty field stays readable as
          "unchanged" instead of collapsing to a null value. */}
      {field("priority", `Priorité (${MIN_PRIORITY} = la plus urgente, facultative)`, (props) => (
        <input
          {...props}
          type="text"
          inputMode="numeric"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value);
            clearField("priority");
          }}
          placeholder={goal ? "Inchangée" : "1"}
        />
      ))}

      <p className="yd-goal-form__note">
        {goal
          ? "Le montant déjà mis de côté est déclaré, jamais lu sur vos comptes : Yieldo ne peut pas savoir quels euros d'un compte appartiennent à quel objectif. La priorité n'est pas renvoyée par l'API : laissez le champ vide pour la conserver."
          : "Le montant déjà mis de côté est déclaré, jamais lu sur vos comptes : Yieldo ne peut pas savoir quels euros d'un compte appartiennent à quel objectif."}
      </p>

      {formError !== null ? (
        <p role="alert" className="yd-goal-form__error yd-goal-form__error--form">
          {formError}
        </p>
      ) : null}

      <div className="yd-goal-form__actions">
        <button type="submit" className="yd-goal-form__save" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          className="yd-goal-form__cancel"
          onClick={onCancel}
          disabled={saving}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
