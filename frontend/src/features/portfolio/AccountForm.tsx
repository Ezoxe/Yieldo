import { useId, useState, type FormEvent } from "react";

import { ApiError, api } from "../../lib/api";
import type { InvestmentAccount, InvestmentAccountIn } from "../../lib/types";
import { Field, FormActions, fieldAria } from "./formField";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** `models.INVESTMENT_ACCOUNT_KINDS`, in the order the backend declares them.
 *  The keys are the wire values; the labels are this screen's French. */
export const INVESTMENT_ACCOUNT_KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "pea", label: "PEA" },
  { value: "pea_pme", label: "PEA-PME" },
  { value: "cto", label: "Compte-titres ordinaire (CTO)" },
  { value: "assurance_vie", label: "Assurance-vie" },
  { value: "per", label: "PER" },
  { value: "crypto_exchange", label: "Plateforme d'échange crypto" },
  { value: "other", label: "Autre" },
];

export function accountKindLabel(kind: string): string {
  return INVESTMENT_ACCOUNT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

/**
 * What an undated envelope costs — and only for the envelopes where it costs
 * something.
 *
 * `models/investment_account.py` states the rule this sentence reports: the
 * PEA's holding-period exemption and the assurance-vie's abatement both count
 * from the envelope's OWN opening date. A CTO, a PER or an exchange account has
 * no such rule, so claiming one for them would be a consequence nobody incurs
 * — this project's most repeated defect is a French sentence naming a cause
 * that does not apply.
 */
function openingDateConsequence(kind: string, openedOn: string): string | null {
  if (openedOn.length > 0) return null;
  if (kind === "pea" || kind === "pea_pme") {
    return "Sans date d'ouverture, l'exonération au bout de 5 ans ne pourra pas être appliquée à cette enveloppe : elle se compte depuis l'ouverture du plan, jamais depuis l'achat d'un titre.";
  }
  if (kind === "assurance_vie") {
    return "Sans date d'ouverture, l'abattement au bout de 8 ans ne pourra pas être appliqué à ce contrat : il se compte depuis son ouverture, jamais depuis un versement.";
  }
  return null;
}

type FieldName = "name" | "kind" | "currency" | "opened";

interface AccountFormProps {
  /** Absent for a creation; the envelope being amended otherwise. */
  account?: InvestmentAccount;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Declare or amend one investment account — the envelope every position lives
 * in, and the first of the three things `/patrimoine` says a position needs.
 *
 * Field errors render at the field (see `formField.tsx`). The one thing this
 * form says that is NOT an error is the opening-date consequence: an undated
 * PEA is a legitimate, savable declaration that simply costs a tax rule, and
 * refusing it would invent a requirement the API does not have.
 */
export function AccountForm({ account, onSaved, onCancel }: AccountFormProps) {
  const baseId = useId();
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState(account?.kind ?? "cto");
  const [currency, setCurrency] = useState(account?.currency ?? "EUR");
  const [openedOn, setOpenedOn] = useState(account?.opened_on ?? "");
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

  function validate():
    | { payload: InvestmentAccountIn }
    | { errors: Partial<Record<FieldName, string>> } {
    const errors: Partial<Record<FieldName, string>> = {};

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      errors.name =
        "Donnez un nom à ce compte, par exemple « PEA Boursorama » : c'est ce qui le distinguera de vos autres enveloppes.";
    }

    const trimmedCurrency = currency.trim();
    if (!/^[A-Za-z]{3}$/.test(trimmedCurrency)) {
      errors.currency =
        "Devise illisible : saisissez un code ISO de trois lettres, par exemple EUR ou USD.";
    }

    if (openedOn.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(openedOn)) {
      errors.opened = "Date illisible : attendue au format AAAA-MM-JJ.";
    }

    if (Object.keys(errors).length > 0) return { errors };
    return {
      payload: {
        name: trimmedName,
        kind,
        // Upper-cased here so "eur" and "EUR" are one code rather than two
        // currencies the valuation would then try to convert between.
        currency: trimmedCurrency.toUpperCase(),
        // Explicitly null, never "": the wire type is `date | None` and an
        // empty string is a 422. Clearing an unknown opening date is a
        // legitimate edit (`InvestmentAccountPatch` leaves it nullable).
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
      if (account) await api.patch(`/portfolio/accounts/${account.id}`, result.payload);
      else await api.post("/portfolio/accounts", result.payload);
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  const consequence = openingDateConsequence(kind, openedOn);

  return (
    <form className="yd-pform" onSubmit={submit} noValidate>
      <h4 className="yd-pform__title">
        {account ? `Modifier « ${account.name} »` : "Nouveau compte d'investissement"}
      </h4>

      <Field id={fieldId("name")} label="Nom du compte" error={fieldErrors.name}>
        <input
          {...fieldAria(fieldId("name"), fieldErrors.name)}
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            clearField("name");
          }}
          placeholder="PEA Boursorama"
        />
      </Field>

      <Field id={fieldId("kind")} label="Type d'enveloppe">
        <select
          id={fieldId("kind")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {INVESTMENT_ACCOUNT_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={fieldId("currency")}
        label="Devise du compte (code ISO)"
        error={fieldErrors.currency}
      >
        <input
          {...fieldAria(fieldId("currency"), fieldErrors.currency)}
          type="text"
          inputMode="text"
          maxLength={3}
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value);
            clearField("currency");
          }}
          placeholder="EUR"
        />
      </Field>

      <Field
        id={fieldId("opened")}
        label="Date d'ouverture (facultative)"
        error={fieldErrors.opened}
        hint={consequence ?? undefined}
      >
        <input
          {...fieldAria(fieldId("opened"), fieldErrors.opened)}
          type="date"
          value={openedOn}
          onChange={(event) => {
            setOpenedOn(event.target.value);
            clearField("opened");
          }}
        />
      </Field>

      <p className="yd-pform__note">
        Un compte d'investissement est une enveloppe : il ne porte aucun solde propre. Sa valeur est
        celle des positions qu'il contient, recalculée à partir de leurs lots.
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
