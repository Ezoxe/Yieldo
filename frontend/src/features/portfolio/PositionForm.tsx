import { useId, useState, type FormEvent } from "react";

import { ApiError, api } from "../../lib/api";
import type { Instrument, InvestmentAccount, Position } from "../../lib/types";
import { ASSET_CLASS_LABEL } from "./HoldingsPanel";
import { Field, FormActions, fieldAria } from "./formField";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

type FieldName = "account" | "symbol" | "name" | "class" | "currency";

interface PositionFormProps {
  accounts: InvestmentAccount[];
  /** The envelope the form opens on — the one whose "Déclarer une position"
   *  button was pressed. Still changeable in the form. */
  accountId: number;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Declare an instrument and open a position on it — steps two and three of the
 * three `/patrimoine` names, in one form because a household does them in one
 * breath.
 *
 * **Two calls, in order, and the second needs the first's answer.** `POST
 * /portfolio/instruments` is a find-or-create keyed on `(symbol, asset_class)`
 * — registering AAPL a second time returns the existing row rather than a
 * duplicate — and the position is then opened on the id it returns. When the
 * second call is refused (a position already exists on that instrument in that
 * account), the instrument stays registered: it is shared, unowned reference
 * data, and nothing about it was wrong.
 *
 * `is_fractionable` defaults to **false**, matching `models/instrument.py`'s
 * own conservative default: the rebalancing engine refuses to size an order
 * smaller than one whole unit of a non-fractionable instrument, and a default
 * of true would silently claim a capability most brokers do not offer.
 */
export function PositionForm({ accounts, accountId, onSaved, onCancel }: PositionFormProps) {
  const baseId = useId();
  const [account, setAccount] = useState(String(accountId));
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("equity");
  const [currency, setCurrency] = useState("EUR");
  const [fractionable, setFractionable] = useState(false);
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
    | { instrument: { symbol: string; name: string; asset_class: string; currency: string; is_fractionable: boolean }; accountId: number }
    | { errors: Partial<Record<FieldName, string>> } {
    const errors: Partial<Record<FieldName, string>> = {};

    const trimmedSymbol = symbol.trim();
    if (trimmedSymbol.length === 0) {
      errors.symbol =
        "Indiquez le symbole sous lequel l'instrument est coté, par exemple AAPL ou BTC-EUR : c'est ce qu'un fournisseur de données sait valoriser.";
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      errors.name =
        "Donnez un nom lisible à cet instrument, par exemple « Apple Inc. » : le symbole seul est illisible dans un tableau.";
    }

    const trimmedCurrency = currency.trim();
    if (!/^[A-Za-z]{3}$/.test(trimmedCurrency)) {
      errors.currency =
        "Devise illisible : saisissez un code ISO de trois lettres, par exemple EUR ou USD.";
    }

    if (accounts.every((entry) => String(entry.id) !== account)) {
      errors.account = "Choisissez le compte d'investissement qui détient cette position.";
    }

    if (Object.keys(errors).length > 0) return { errors };
    return {
      accountId: Number(account),
      instrument: {
        symbol: trimmedSymbol,
        name: trimmedName,
        asset_class: assetClass,
        currency: trimmedCurrency.toUpperCase(),
        is_fractionable: fractionable,
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
      const instrument = await api.post<Instrument>("/portfolio/instruments", result.instrument);
      await api.post<Position>("/portfolio/positions", {
        investment_account_id: result.accountId,
        instrument_id: instrument.id,
      });
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="yd-pform" onSubmit={submit} noValidate>
      <h4 className="yd-pform__title">Nouvelle position</h4>

      <Field id={fieldId("account")} label="Compte d'investissement" error={fieldErrors.account}>
        <select
          {...fieldAria(fieldId("account"), fieldErrors.account)}
          value={account}
          onChange={(event) => {
            setAccount(event.target.value);
            clearField("account");
          }}
        >
          {accounts.map((entry) => (
            <option key={entry.id} value={String(entry.id)}>
              {entry.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id={fieldId("symbol")} label="Symbole coté" error={fieldErrors.symbol}>
        <input
          {...fieldAria(fieldId("symbol"), fieldErrors.symbol)}
          type="text"
          value={symbol}
          onChange={(event) => {
            setSymbol(event.target.value);
            clearField("symbol");
          }}
          placeholder="AAPL"
        />
      </Field>

      <Field id={fieldId("name")} label="Nom de l'instrument" error={fieldErrors.name} wide>
        <input
          {...fieldAria(fieldId("name"), fieldErrors.name)}
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            clearField("name");
          }}
          placeholder="Apple Inc."
        />
      </Field>

      <Field id={fieldId("class")} label="Classe d'actifs">
        <select
          id={fieldId("class")}
          value={assetClass}
          onChange={(event) => setAssetClass(event.target.value)}
        >
          {Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={fieldId("currency")}
        label="Devise de cotation (code ISO)"
        error={fieldErrors.currency}
      >
        <input
          {...fieldAria(fieldId("currency"), fieldErrors.currency)}
          type="text"
          maxLength={3}
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value);
            clearField("currency");
          }}
          placeholder="EUR"
        />
      </Field>

      <div className="yd-pform__field yd-pform__field--check">
        <input
          id={`${baseId}-fractionable`}
          type="checkbox"
          checked={fractionable}
          onChange={(event) => setFractionable(event.target.checked)}
        />
        <label htmlFor={`${baseId}-fractionable`}>Fractionnable (achat par fractions d'unité)</label>
        <p className="yd-pform__hint">
          Décoché par défaut, le choix prudent : une classe fractionnable permet à Yieldo de
          proposer un ordre plus petit qu'une unité, ce que la plupart des courtiers n'offrent pas
          sur une action.
        </p>
      </div>

      <p className="yd-pform__note">
        Une position déclarée seule ne détient encore rien : sa quantité est la somme de ses lots,
        et c'est le premier lot, déclaré juste après, qui lui en donnera une.
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
