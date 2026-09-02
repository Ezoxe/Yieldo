import { useId, useState, type FormEvent } from "react";

import { formatRateBps, parseRateBps } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { AllocationTarget, AllocationTargetIn } from "../../lib/types";
import { ASSET_CLASS_LABEL, assetClassLabel } from "./HoldingsPanel";
import { FormActions } from "./formField";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** 100,00 % in basis points — `engines.allocation.validate_targets`' own
 *  invariant, restated here so the household is told before the request is
 *  sent rather than by a 422 afterwards. */
const FULL_BPS = 10_000;

interface Row {
  /** Stable across re-orders and removals, so React keys a row rather than an
   *  index — an index key on an editable list moves the value into the row
   *  above when one is removed. */
  key: number;
  assetClass: string;
  /** As typed: "60", "62,50". Kept as text so what was typed is what is shown
   *  back, and converted to integer basis points once, on submit. */
  share: string;
}

/** `formatRateBps`' inverse, for a field's initial value: 6 000 is "60,00". */
function bpsToInput(bps: number): string {
  return `${Math.trunc(bps / 100)},${String(bps % 100).padStart(2, "0")}`;
}

function initialRows(targets: AllocationTarget[]): Row[] {
  if (targets.length === 0) {
    // A household that declared nothing starts on one empty row rather than on
    // an empty list: an "Ajouter une classe" button alone reads as though the
    // form had failed to load.
    return [{ key: 0, assetClass: "equity", share: "" }];
  }
  return targets.map((target, index) => ({
    key: index,
    assetClass: target.asset_class,
    share: bpsToInput(target.target_bps),
  }));
}

interface TargetsFormProps {
  /** The stored set, as `GET /api/portfolio/allocation` returns it. */
  targets: AllocationTarget[];
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * The target allocation — declared as a WHOLE SET, never row by row.
 *
 * `engines.allocation.validate_targets` refuses a set that does not sum to
 * exactly 100 %, and that invariant spans rows: patching one target could only
 * ever leave the stored set in a state `GET /allocation` would refuse to read
 * back. So the API replaces everything in one `PUT`, and so does this form.
 *
 * **The sum is shown as it is typed and checked before the request leaves.**
 * Not because the engine's own guard is unreliable — it is the authority, and
 * its French is printed verbatim if it ever refuses — but because a household
 * distributing percentages across five classes needs to see the running total
 * while it distributes them, not after.
 *
 * An empty set is a legitimate payload and deliberately skips the 100 % check:
 * it means "I have declared no target allocation", which is where every
 * household starts and is not the same thing as a set that sums wrong.
 */
export function TargetsForm({ targets, onSaved, onCancel }: TargetsFormProps) {
  const baseId = useId();
  const [rows, setRows] = useState<Row[]>(() => initialRows(targets));
  const [nextKey, setNextKey] = useState(() => Math.max(1, targets.length));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** The running sum, in basis points, over the rows that parse. A row that
   *  does not parse contributes nothing rather than a guess — and submitting
   *  refuses it by name. */
  const sumBps = rows.reduce((total, row) => {
    const bps = row.share.trim().length === 0 ? 0 : parseRateBps(row.share);
    return total + (bps ?? 0);
  }, 0);
  const balanced = rows.length === 0 || sumBps === FULL_BPS;

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setError(null);
  }

  function addRow() {
    const used = new Set(rows.map((row) => row.assetClass));
    const free = Object.keys(ASSET_CLASS_LABEL).find((value) => !used.has(value));
    setRows((current) => [
      ...current,
      { key: nextKey, assetClass: free ?? "other", share: "" },
    ]);
    setNextKey((key) => key + 1);
    setError(null);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
    setError(null);
  }

  function validate(): { payload: AllocationTargetIn[] } | { error: string } {
    const payload: AllocationTargetIn[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      // An empty row is missing, not unreadable — two states, two remedies,
      // and only one of them is "retype it".
      if (row.share.trim().length === 0) {
        return {
          error: `Part manquante pour « ${assetClassLabel(row.assetClass)} » : indiquez le pourcentage visé, ou retirez cette classe.`,
        };
      }
      const bps = parseRateBps(row.share);
      if (bps === null) {
        return { error: "Part illisible : saisissez un pourcentage, par exemple 60 ou 62,50." };
      }
      if (seen.has(row.assetClass)) {
        return {
          error: `La classe « ${assetClassLabel(row.assetClass)} » porte deux cibles : une classe d'actifs n'en accepte qu'une seule.`,
        };
      }
      seen.add(row.assetClass);
      payload.push({ asset_class: row.assetClass, target_bps: bps });
    }

    const total = payload.reduce((sum, target) => sum + target.target_bps, 0);
    if (payload.length > 0 && total !== FULL_BPS) {
      // The gap, named and signed — "la somme ne fait pas 100 %" leaves the
      // household to work out which way and by how much.
      const gap = Math.abs(total - FULL_BPS);
      const remedy =
        total < FULL_BPS
          ? `Ajoutez les ${formatRateBps(gap)} manquants`
          : `Retirez les ${formatRateBps(gap)} en trop`;
      return {
        error: `La somme des parts visées fait ${formatRateBps(total)}, alors qu'elle doit faire exactement ${formatRateBps(FULL_BPS)}. ${remedy} avant d'enregistrer.`,
      };
    }
    return { payload };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate();
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put("/portfolio/targets", { targets: result.payload });
      onSaved();
    } catch (err) {
      // The engine refuses in French already; printed verbatim, because it
      // names which class or which invariant it refused on.
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="yd-targets-form yd-pform" onSubmit={submit} noValidate>
      <h4 className="yd-pform__title">Allocation cible</h4>

      <ul className="yd-targets-form__rows">
        {rows.map((row) => (
          <li className="yd-targets-form__row" key={row.key}>
            <div className="yd-pform__field">
              <label htmlFor={`${baseId}-${row.key}-class`}>Classe d'actifs</label>
              <select
                id={`${baseId}-${row.key}-class`}
                value={row.assetClass}
                onChange={(event) => update(row.key, { assetClass: event.target.value })}
              >
                {Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="yd-pform__field">
              <label htmlFor={`${baseId}-${row.key}-share`}>Part visée (%)</label>
              <input
                id={`${baseId}-${row.key}-share`}
                type="text"
                inputMode="decimal"
                value={row.share}
                onChange={(event) => update(row.key, { share: event.target.value })}
                placeholder="60"
              />
            </div>

            <button
              type="button"
              className="yd-targets-form__remove"
              onClick={() => removeRow(row.key)}
            >
              <span className="sr-only">{`Retirer ${assetClassLabel(row.assetClass)}`}</span>
              <span aria-hidden="true">Retirer</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="yd-targets-form__foot">
        <button type="button" className="yd-targets-form__add" onClick={addRow}>
          Ajouter une classe
        </button>
        <p
          className={`yd-targets-form__sum${balanced ? " yd-targets-form__sum--balanced" : ""}`}
          data-testid="yd-targets-sum"
        >
          {/* The state is written out, not signalled by the colour alone: a
              reader who cannot tell the two colours apart has to be able to
              read whether this set can be saved. */}
          {`Somme des parts visées : ${formatRateBps(sumBps)}${
            rows.length === 0
              ? ""
              : balanced
                ? " — la somme est complète."
                : sumBps < FULL_BPS
                  ? ` — il manque ${formatRateBps(FULL_BPS - sumBps)}.`
                  : ` — ${formatRateBps(sumBps - FULL_BPS)} de trop.`
          }`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="yd-pform__note">
          Aucune classe : enregistrer maintenant efface votre allocation cible, et Yieldo cessera de
          mesurer l'écart avec votre répartition actuelle — il ne le remplacera pas par des zéros.
        </p>
      ) : (
        <p className="yd-pform__note">
          La somme doit faire exactement 100 %. C'est une décision qui vous appartient : Yieldo ne
          propose aucune répartition par défaut et n'en recommande aucune.
        </p>
      )}

      {error !== null ? (
        <p role="alert" className="yd-pform__error yd-pform__error--form">
          {error}
        </p>
      ) : null}

      <FormActions saving={saving} onCancel={onCancel} />
    </form>
  );
}
