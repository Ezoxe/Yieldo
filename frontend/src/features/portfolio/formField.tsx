import type { ReactNode } from "react";

/**
 * The one field wrapper the four `/patrimoine` forms share.
 *
 * `DebtForm` and `GoalForm` each carry a private copy of this helper, and the
 * second documented that a third caller was the moment it should move. Four
 * arrived at once here, in one feature — so they share one, and the French for
 * every label and message still lives in the form that owns it, never in here.
 *
 * The rules it enforces are the ones this project has already paid for:
 * a visible `<label>` bound by `htmlFor` (never a placeholder standing in for
 * one), the error rendered **at the field** rather than in a page-level alert
 * several screens above it at 375 px, `aria-invalid` on every state so a
 * screen reader hears the field is valid too, and `role="alert"` so the message
 * is announced rather than merely painted red.
 */

export interface FieldAria {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}

export function fieldAria(id: string, error: string | undefined): FieldAria {
  return {
    id,
    "aria-invalid": error !== undefined,
    "aria-describedby": error !== undefined ? `${id}-error` : undefined,
  };
}

export function Field({
  id,
  label,
  error,
  hint,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  /** What the field costs or implies — never a restatement of the label, and
   *  never where an error belongs. */
  hint?: ReactNode;
  /** Spans both columns from 640 px: for a field whose value is long. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`yd-pform__field${wide ? " yd-pform__field--wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined ? <p className="yd-pform__hint">{hint}</p> : null}
      {error !== undefined ? (
        <p id={`${id}-error`} role="alert" className="yd-pform__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The save / cancel pair every one of these forms ends with. */
export function FormActions({
  saving,
  onCancel,
  saveLabel = "Enregistrer",
}: {
  saving: boolean;
  onCancel: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="yd-pform__actions">
      <button type="submit" className="yd-pform__save" disabled={saving}>
        {saving ? "Enregistrement…" : saveLabel}
      </button>
      <button type="button" className="yd-pform__cancel" onClick={onCancel} disabled={saving}>
        Annuler
      </button>
    </div>
  );
}
