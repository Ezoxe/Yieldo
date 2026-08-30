import { useId, useState, type FormEvent, type ReactNode } from "react";

import { centsToInput, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Debt, DebtIn } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** `models.DEBT_KINDS`, in the order the backend declares them. The keys are
 *  the wire values; the labels are this screen's French. */
export const DEBT_KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "mortgage", label: "Prêt immobilier" },
  { value: "auto", label: "Crédit auto" },
  { value: "consumer", label: "Crédit à la consommation" },
  { value: "student", label: "Prêt étudiant" },
  { value: "credit_card", label: "Carte de crédit" },
  { value: "personal", label: "Prêt personnel" },
  { value: "other", label: "Autre" },
];

/** Basis points back into a percentage: 490 is "4,90". */
function bpsToInput(bps: number): string {
  const sign = bps < 0 ? "-" : "";
  const absolute = Math.abs(bps);
  return `${sign}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * A typed percentage into integer basis points.
 *
 * `Number(text) * 100` is acceptable **here and only here**, because a rate is
 * not money: it is a ratio the engine converts to a `Decimal` before it ever
 * multiplies a cents value, so no float reaches an amount. **Do not copy this
 * onto a euro field** — that is what `parseCents` exists for, and
 * `parseFloat("8.70") * 100` is 869.9999999999999.
 */
export function parseRateBps(text: string): number | null {
  const cleaned = text.replace(/[\s  %]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** `schemas.DebtIn.annual_rate_bps`: `ge=0, le=10_000`. */
const MAX_RATE_BPS = 10_000;
/** `schemas.DebtIn.term_months`: `ge=1, le=480`. */
const MAX_TERM_MONTHS = 480;

interface DebtFormProps {
  /** Absent for a creation; the row being amended otherwise. */
  debt?: Debt;
  onSaved: () => void;
  onCancel: () => void;
}

type FieldName = "name" | "principal" | "rate" | "payment" | "term" | "opened";

/**
 * Add or amend one debt.
 *
 * Every euro field goes through `parseCents` — string arithmetic, and `null`
 * rather than 0 on anything it cannot read exactly, so an unreadable amount can
 * never be saved as nothing.
 *
 * Field errors render **at the field**, with `aria-invalid` and
 * `aria-describedby`. Sent to a page-level alert instead they land above the
 * bento grid, which at 375px is several screens above the input: phase 2A task
 * 6 shipped that and the operator saw the button re-enable and nothing else
 * change. Only a failure with no field to attach to — a rejection from the
 * backend naming no field — stays at the form's own level.
 */
export function DebtForm({ debt, onSaved, onCancel }: DebtFormProps) {
  const baseId = useId();
  const [name, setName] = useState(debt?.name ?? "");
  const [kind, setKind] = useState(debt?.kind ?? "consumer");
  const [principal, setPrincipal] = useState(
    debt ? centsToInput(debt.principal_cents) : "",
  );
  const [rate, setRate] = useState(debt ? bpsToInput(debt.annual_rate_bps) : "0,00");
  const [payment, setPayment] = useState(
    debt ? centsToInput(debt.minimum_payment_cents) : "",
  );
  const [term, setTerm] = useState(
    debt?.term_months != null ? String(debt.term_months) : "",
  );
  const [openedOn, setOpenedOn] = useState(debt?.opened_on ?? "");
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
  function validate(): { payload: DebtIn } | { errors: Partial<Record<FieldName, string>> } {
    const errors: Partial<Record<FieldName, string>> = {};

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      errors.name = "Donnez un intitulé à cette dette, par exemple « Crédit auto ».";
    }

    const principalCents = parseCents(principal);
    if (principalCents === null) {
      errors.principal = "Montant illisible : saisissez un montant en euros, par exemple 12 000,00.";
    } else if (principalCents < 0) {
      errors.principal = "Le capital restant dû ne peut pas être négatif : c'est un montant dû, pas un mouvement.";
    }

    const rateBps = parseRateBps(rate);
    if (rateBps === null) {
      errors.rate = "Taux illisible : saisissez un pourcentage annuel, par exemple 4,90.";
    } else if (rateBps > MAX_RATE_BPS) {
      errors.rate = "Le taux annuel ne peut pas dépasser 100,00 %.";
    }

    const paymentCents = parseCents(payment);
    if (paymentCents === null) {
      errors.payment = "Montant illisible : saisissez une mensualité en euros, par exemple 250,00.";
    } else if (paymentCents < 0) {
      errors.payment = "La mensualité ne peut pas être négative.";
    }

    let termMonths: number | null = null;
    if (term.trim().length > 0) {
      if (!/^\d+$/.test(term.trim())) {
        errors.term = "Durée illisible : saisissez un nombre de mois, par exemple 48.";
      } else {
        termMonths = Number(term.trim());
        if (termMonths < 1 || termMonths > MAX_TERM_MONTHS) {
          errors.term = `La durée restante doit tenir entre 1 et ${MAX_TERM_MONTHS} mois.`;
        }
      }
    }

    if (openedOn.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(openedOn)) {
      errors.opened = "Date illisible : attendue au format AAAA-MM-JJ.";
    }

    if (Object.keys(errors).length > 0) return { errors };
    return {
      payload: {
        name: trimmed,
        kind,
        principal_cents: principalCents as number,
        annual_rate_bps: rateBps as number,
        minimum_payment_cents: paymentCents as number,
        term_months: termMonths,
        opened_on: openedOn.length > 0 ? openedOn : null,
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
      if (debt) await api.patch(`/debts/${debt.id}`, result.payload);
      else await api.post("/debts", result.payload);
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  function field(
    name: FieldName,
    label: string,
    input: (props: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby": string | undefined;
    }) => ReactNode,
  ) {
    const message = fieldErrors[name];
    return (
      <div className="yd-debt-form__field">
        <label htmlFor={fieldId(name)}>{label}</label>
        {input({
          id: fieldId(name),
          "aria-invalid": message !== undefined,
          "aria-describedby": message !== undefined ? errorId(name) : undefined,
        })}
        {message !== undefined ? (
          <p id={errorId(name)} role="alert" className="yd-debt-form__error">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="yd-debt-form" onSubmit={submit} noValidate>
      <h3 className="yd-debt-form__title">
        {debt ? `Modifier « ${debt.name} »` : "Nouvelle dette"}
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
          placeholder="Crédit auto"
        />
      ))}

      <div className="yd-debt-form__field">
        <label htmlFor={`${baseId}-kind`}>Type</label>
        <select
          id={`${baseId}-kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {DEBT_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      {field("principal", "Capital restant dû (€)", (props) => (
        <input
          {...props}
          type="text"
          inputMode="decimal"
          value={principal}
          onChange={(event) => {
            setPrincipal(event.target.value);
            clearField("principal");
          }}
          placeholder="12 000,00"
        />
      ))}

      {field("rate", "Taux annuel (%)", (props) => (
        <input
          {...props}
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
            clearField("rate");
          }}
          placeholder="4,90"
        />
      ))}

      {field("payment", "Mensualité minimale (€)", (props) => (
        <input
          {...props}
          type="text"
          inputMode="decimal"
          value={payment}
          onChange={(event) => {
            setPayment(event.target.value);
            clearField("payment");
          }}
          placeholder="250,00"
        />
      ))}

      {field("term", "Durée restante (mois, facultatif)", (props) => (
        <input
          {...props}
          type="text"
          inputMode="numeric"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            clearField("term");
          }}
          placeholder="48"
        />
      ))}

      {field("opened", "Date d'ouverture (facultatif)", (props) => (
        <input
          {...props}
          type="date"
          value={openedOn}
          onChange={(event) => {
            setOpenedOn(event.target.value);
            clearField("opened");
          }}
        />
      ))}

      <p className="yd-debt-form__note">
        La durée et la date d'ouverture sont indicatives : l'échéancier est calculé sur le capital,
        le taux et la mensualité, jamais sur la durée déclarée.
      </p>

      {formError !== null ? (
        <p role="alert" className="yd-debt-form__error yd-debt-form__error--form">
          {formError}
        </p>
      ) : null}

      <div className="yd-debt-form__actions">
        <button type="submit" className="yd-debt-form__save" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" className="yd-debt-form__cancel" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
      </div>
    </form>
  );
}
