import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "../../lib/api";
import type { ImportBatch } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular;
}

/** "12 août 2026 à 08:29", in the reader's own locale conventions. */
export function batchDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * What deleting this batch costs, in the user's own terms.
 *
 * Written against what `DELETE /api/imports/{id}` actually does (see
 * backend/app/api/imports.py and `rollback_import`): it deletes every
 * transaction carrying this batch id for this user, then the batch row itself.
 * It does not touch the archived copy of the CSV, so nothing here claims the
 * file is going anywhere. `rows_imported` is what the batch recorded on the day
 * -- the server reports the number it actually removed once the deletion runs,
 * and that is the figure the confirmation notice repeats.
 */
export function rollbackWarning(batch: ImportBatch): string {
  const count = batch.rows_imported;
  if (count === 0) {
    return "Cet import n'a créé aucune transaction : seul le lot sera retiré de cet historique. Cette action est irréversible.";
  }
  return (
    `Cet import a créé ${count} ${plural(count, "transaction", "transactions")} : ` +
    `${plural(count, "elle sera supprimée", "elles seront supprimées")} avec le lot. ` +
    "Cette action est irréversible."
  );
}

interface CountItem {
  key: string;
  value: number;
  label: string;
  tone?: "duplicate" | "failed";
}

function countsOf(batch: ImportBatch): CountItem[] {
  return [
    { key: "total", value: batch.rows_total, label: plural(batch.rows_total, "ligne lue", "lignes lues") },
    {
      key: "imported",
      value: batch.rows_imported,
      label: plural(batch.rows_imported, "importée", "importées"),
    },
    {
      key: "duplicate",
      value: batch.rows_duplicate,
      label: plural(batch.rows_duplicate, "doublon", "doublons"),
      tone: "duplicate",
    },
    {
      key: "failed",
      value: batch.rows_failed,
      label: plural(batch.rows_failed, "en erreur", "en erreur"),
      tone: "failed",
    },
  ];
}

/**
 * Past imports, most recent first, with the rollback that undoes one.
 *
 * `GET /api/imports` and `DELETE /api/imports/{id}` had existed since phase 1
 * with no screen calling either: an operator who had already imported had no
 * way to see what he had imported, and no way to undo it once he had left the
 * wizard's last step.
 *
 * It lives on the wizard's landing step because that is where someone who has
 * already imported goes looking. Rollback is destructive and irreversible, so
 * it confirms first, in French, naming what will be removed -- and the
 * confirmation is inline rather than a dialog: there is no modal primitive in
 * this app, and a focus trap that only half works is worse than none.
 */
export function ImportHistory() {
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      setBatches(await api.get<ImportBatch[]>("/imports"));
      setError(null);
    } catch (err) {
      // Never an empty list standing in for a list that could not be read.
      setBatches(null);
      setError(messageFor(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Focus moves to Annuler, not to the destructive button: a keyboard user who
  // reached "Supprimer cet import" with Enter must not have the confirmation
  // land under the same key.
  useEffect(() => {
    if (confirmingId !== null) cancelRef.current?.focus();
  }, [confirmingId]);

  async function handleRollback(batch: ImportBatch) {
    setBusyId(batch.id);
    setError(null);
    try {
      const result = await api.delete<{ removed: number }>(`/imports/${batch.id}`);
      setConfirmingId(null);
      // The server's own figure, not the batch's record of what it once
      // imported: rows deleted since then are not removed twice.
      setNotice(
        `Import supprimé : ${result.removed} ${plural(result.removed, "transaction retirée", "transactions retirées")}.`,
      );
      await load();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="yd-import-history">
      <h2 className="yd-panel__title">Imports précédents</h2>

      {error ? (
        <p role="alert" className="yd-import__alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="yd-import-history__notice">
          {notice}
        </p>
      ) : null}

      {batches === null && error === null ? (
        <p className="yd-import__hint">Chargement de l'historique…</p>
      ) : null}

      {batches !== null && batches.length === 0 ? (
        <p className="yd-import__hint">
          Aucun import pour le moment. Le premier relevé que vous validerez apparaîtra ici.
        </p>
      ) : null}

      {batches !== null && batches.length > 0 ? (
        <ul className="yd-import-history__list">
          {batches.map((batch) => (
            <li className="yd-import-history__item" key={batch.id}>
              <div className="yd-import-history__head">
                <span className="yd-import-history__filename">{batch.filename}</span>
                <span className="yd-import-history__date">{batchDateTime(batch.created_at)}</span>
              </div>

              <dl className="yd-import-history__counts">
                {countsOf(batch).map((count) => (
                  <div
                    className="yd-import-history__count"
                    key={count.key}
                    // Only a non-zero figure earns its tone: "0 en erreur" is
                    // good news, and colouring it red says the opposite.
                    data-tone={count.value > 0 ? count.tone : undefined}
                  >
                    <dt className="yd-num yd-import-history__count-value">{count.value}</dt>
                    <dd className="yd-import-history__count-label">{count.label}</dd>
                  </div>
                ))}
              </dl>

              {confirmingId === batch.id ? (
                <div
                  className="yd-import-history__confirm"
                  role="group"
                  aria-label={`Confirmer la suppression de ${batch.filename}`}
                >
                  <p role="alert" className="yd-import-history__warning">
                    {rollbackWarning(batch)}
                  </p>
                  <div className="yd-import-history__confirm-actions">
                    <button
                      type="button"
                      className="yd-import-history__delete"
                      onClick={() => void handleRollback(batch)}
                      disabled={busyId === batch.id}
                    >
                      {busyId === batch.id ? "Suppression…" : "Supprimer définitivement"}
                    </button>
                    <button
                      type="button"
                      className="yd-import-history__cancel"
                      ref={cancelRef}
                      onClick={() => setConfirmingId(null)}
                      disabled={busyId === batch.id}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="yd-import-history__rollback"
                  onClick={() => {
                    setNotice(null);
                    setConfirmingId(batch.id);
                  }}
                >
                  Supprimer cet import
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
