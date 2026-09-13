import { useEffect, useState } from "react";

import { ListSkeleton } from "../../design/ListSkeleton";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { RecurrenceDismissal } from "../../lib/types";
import "./DismissedDetectionsPanel.css";

/**
 * The labels the household has said are not subscriptions, and the way to
 * give any of them back to the detection.
 *
 * A dismissal that could not be seen would be a filter that could not be
 * revoked: the detection would go quiet on a label for ever, and the
 * household would be left with a « Coût de vos dépenses récurrentes » that
 * silently leaves things out — the exact opposite of what the audit of
 * 2026-09-06 asked of that panel.
 */
export function DismissedDetectionsPanel() {
  const [rows, setRows] = useState<RecurrenceDismissal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<RecurrenceDismissal[]>("/recurrences/dismissals")
      .then((body) => {
        if (!cancelled) setRows(body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function restore(row: RecurrenceDismissal) {
    setBusyId(row.id);
    try {
      await api.delete(`/recurrences/dismissals/${row.id}`);
      setRows((current) => (current ?? []).filter((item) => item.id !== row.id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="yd-dismissed" data-testid="yd-dismissed">
      <p className="yd-settings__note">
        Ce que vous avez écarté de la détection des récurrences avec « Ce n'est pas un
        abonnement ». Rétablir un libellé le rend à la détection au prochain calcul.
      </p>
      {error !== null ? (
        <p role="alert" className="yd-dismissed__alert">
          {error}
        </p>
      ) : null}
      {rows === null && error === null ? (
        <ListSkeleton rows={2} label="Chargement des détections écartées" />
      ) : rows !== null && rows.length === 0 ? (
        <p className="yd-dismissed__empty">Aucun libellé écarté.</p>
      ) : rows !== null ? (
        <>
          <p className="yd-dismissed__count">
            {`${rows.length} ${plural(rows.length, "libellé écarté", "libellés écartés")}`}
          </p>
          <ul className="yd-dismissed__list" aria-label="Détections écartées">
            {rows.map((row) => (
              <li key={row.id} className="yd-dismissed__row">
                <span className="yd-dismissed__label">{row.label}</span>
                <button
                  type="button"
                  className="yd-dismissed__restore"
                  disabled={busyId === row.id}
                  onClick={() => void restore(row)}
                >
                  <span className="sr-only">{`Rétablir ${row.label}`}</span>
                  <span aria-hidden="true">Rétablir</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
