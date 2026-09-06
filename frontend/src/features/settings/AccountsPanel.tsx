import { useEffect, useState, type FormEvent } from "react";

import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Account, AccountBalance, BalanceBreakdown } from "../../lib/types";
import "./AccountsPanel.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

const KINDS: { value: string; label: string }[] = [
  { value: "checking", label: "Compte courant" },
  { value: "savings", label: "Livret" },
  { value: "cash", label: "Espèces" },
];

export function kindLabel(kind: string): string {
  return KINDS.find((option) => option.value === kind)?.label ?? kind;
}

/**
 * A euro amount that may be negative or zero, as integer cents.
 *
 * Deliberately not `TransactionForm.parseAmountToCents`: that one refuses a
 * sign and refuses zero, because an operation's direction is a control beside
 * the field and a zero movement is a typing slip. An opening balance is neither
 * — an overdrawn account opens below zero, and a fresh one opens at exactly
 * zero. Same integer-only arithmetic, different domain.
 */
export function parseSignedAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".").replace("−", "-");
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  return negative ? -cents : cents;
}

/** Stored cents, back into the field a person types in — sign included here,
 *  since the field carries it. */
export function centsToSignedInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

interface RowProps {
  account: AccountBalance;
  onSaved: () => void;
}

function AccountRow({ account, onSaved }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [opening, setOpening] = useState(centsToSignedInput(account.opening_balance_cents));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = parseSignedAmountToCents(opening);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") {
      setError("Le nom du compte est obligatoire.");
      return;
    }
    if (cents === null) {
      setError("Le solde initial doit être un nombre, avec au plus deux décimales.");
      return;
    }
    setSaving(true);
    try {
      await api.patch<Account>(`/accounts/${account.id}`, {
        name: name.trim(),
        opening_balance_cents: cents,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    setError(null);
    setSaving(true);
    try {
      await api.delete(`/accounts/${account.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      setSaving(false);
    }
  }

  return (
    <li className="yd-accounts__row">
      <div className="yd-accounts__head">
        <div>
          <p className="yd-accounts__name">{account.name}</p>
          <p className="yd-accounts__meta">
            {kindLabel(account.kind)} ·{" "}
            <span className="yd-num">{formatCents(account.balance_cents, { signed: true })}</span>{" "}
            {`sur ${account.transaction_count} ${plural(account.transaction_count, "opération", "opérations")}`}
          </p>
        </div>
        <div className="yd-accounts__actions">
          <button type="button" onClick={() => setEditing((open) => !open)} disabled={saving}>
            {editing ? "Fermer" : "Modifier"}
          </button>
          <button type="button" onClick={() => void archive()} disabled={saving}>
            Archiver
          </button>
        </div>
      </div>

      {/* Archiving, never deleting, and the sentence says so rather than
          letting a reader discover it: the transactions imported onto this
          account must never lose the account they belong to. */}
      {editing ? (
        <form className="yd-accounts__form" onSubmit={save}>
          <div className="yd-accounts__field">
            <label htmlFor={`account-name-${account.id}`}>Nom</label>
            <input
              id={`account-name-${account.id}`}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="yd-accounts__field">
            <label htmlFor={`account-opening-${account.id}`}>Solde initial (€)</label>
            <input
              id={`account-opening-${account.id}`}
              type="text"
              inputMode="decimal"
              className="yd-num"
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
              aria-invalid={cents === null}
            />
            <p className="yd-accounts__hint">
              Le solde du compte avant la première opération importée. S'il porte déjà le solde du
              jour et que l'historique a été importé ensuite, il est compté deux fois.
            </p>
          </div>
          {error !== null ? (
            <p className="yd-accounts__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="yd-accounts__save" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      ) : error !== null ? (
        <p className="yd-accounts__error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function NewAccountForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("checking");
  const [opening, setOpening] = useState("0,00");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = parseSignedAmountToCents(opening);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") {
      setError("Le nom du compte est obligatoire.");
      return;
    }
    if (cents === null) {
      setError("Le solde initial doit être un nombre, avec au plus deux décimales.");
      return;
    }
    setSaving(true);
    try {
      await api.post<Account>("/accounts", {
        name: name.trim(),
        kind,
        opening_balance_cents: cents,
      });
      setName("");
      setOpening("0,00");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="yd-accounts__new" onSubmit={submit}>
      <div className="yd-accounts__field">
        <label htmlFor="account-new-name">Nom du compte</label>
        <input
          id="account-new-name"
          type="text"
          placeholder="Compte courant"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="yd-accounts__field">
        <label htmlFor="account-new-kind">Type</label>
        <select
          id="account-new-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="yd-accounts__field">
        <label htmlFor="account-new-opening">Solde initial (€)</label>
        <input
          id="account-new-opening"
          type="text"
          inputMode="decimal"
          className="yd-num"
          value={opening}
          onChange={(event) => setOpening(event.target.value)}
          aria-invalid={cents === null}
        />
      </div>
      {error !== null ? (
        <p className="yd-accounts__error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="yd-accounts__save" disabled={saving}>
        {saving ? "Création…" : "Ajouter le compte"}
      </button>
    </form>
  );
}

/**
 * The bank accounts, and the one figure on them nothing could correct.
 *
 * `AccountPatch` carried no `opening_balance_cents` and no screen listed the
 * accounts at all, so a household that typed today's balance as the opening one
 * and then imported five years of history was stuck with a solde it did not
 * recognise, on every screen that reads a balance. Two error messages already
 * pointed here ("créez-en un dans Réglages → Comptes"); until now they pointed
 * at nothing.
 */
export function AccountsPanel() {
  const [data, setData] = useState<BalanceBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await api.get<BalanceBreakdown>("/accounts/balance");
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = () => setToken((value) => value + 1);

  if (error !== null) {
    return (
      <p className="yd-accounts__error" role="alert">
        {error}
      </p>
    );
  }
  if (data === null) return null;

  return (
    <div className="yd-accounts">
      {data.accounts.length === 0 ? (
        <p className="yd-accounts__empty">
          Aucun compte déclaré. Créez-en un ici, ou laissez l'import d'un relevé le créer pour vous.
        </p>
      ) : (
        <ul className="yd-accounts__list">
          {data.accounts.map((account) => (
            <AccountRow key={account.id} account={account} onSaved={reload} />
          ))}
        </ul>
      )}

      <p className="yd-accounts__note">
        Un compte est archivé, jamais supprimé : les opérations importées dessus ne doivent pas
        perdre le compte auquel elles appartiennent.
      </p>

      <NewAccountForm onCreated={reload} />
    </div>
  );
}
