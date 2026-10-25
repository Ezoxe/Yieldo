import { useEffect, useState } from "react";

import { CopyIcon } from "../../design/icons";
import { api } from "../../lib/api";
import { messageFor } from "../../lib/refusal";
import type { ConnectorAction, ConnectorKeyCreated, ConnectorKeyStatus } from "../../lib/types";

/** Where the key goes on the EZLink machine, relative to its `deploy/gateway` folder. */
export const KEY_FILE = "data/yieldo_key";

const MOMENT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

function moment(iso: string | null): string {
  if (iso === null) return "";
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? iso : MOMENT.format(value);
}

/** The state of one action, as a pill: what the household needs to know is
 *  whether it happened, and whether it went through Discord first. */
export function actionPill(action: ConnectorAction): { tone: string; text: string } {
  if (action.status_code >= 400) {
    return { tone: "negative", text: `Refusé par Yieldo (${action.status_code})` };
  }
  if (action.tier === "approve") return { tone: "accent", text: "Validé sur Discord" };
  return { tone: "positive", text: "Fait" };
}

/**
 * « Yieldo Finance » — the key EZLink's Yieldo agent holds, and what Claude did
 * with it.
 *
 * The key is shown once, at creation, and never again: Yieldo keeps only its
 * hash (`models/connector_key.py`). Creating another replaces it at once, which
 * is also the way out of a key pasted somewhere it should not be.
 */
export function ConnectorPanel() {
  const [status, setStatus] = useState<ConnectorKeyStatus | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [actions, setActions] = useState<ConnectorAction[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<ConnectorKeyStatus>("/connector-key"),
      api.get<ConnectorAction[]>("/connector-key/actions"),
    ])
      .then(([keyStatus, latest]) => {
        if (cancelled) return;
        setStatus(keyStatus);
        setActions(latest);
      })
      .catch((err) => {
        if (!cancelled) setError(messageFor(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createKey() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const body = await api.post<ConnectorKeyCreated>("/connector-key");
      setCreated(body.key);
      setStatus({ exists: true, created_at: body.created_at, last_used_at: null });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey() {
    setBusy(true);
    setError(null);
    try {
      await api.delete("/connector-key");
      setCreated(null);
      setStatus({ exists: false, created_at: null, last_used_at: null });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      setError("La copie a été refusée par le navigateur : sélectionnez la clé et copiez-la.");
    }
  }

  return (
    <div className="yd-connector">
      <p className="yd-connections__note">
        Claude agit sur Yieldo à travers EZLink, avec le connecteur « Yieldo Finance »&nbsp;: il
        lit tout, corrige ce qui se corrige, et attend votre clic sur Discord avant de supprimer
        ou de toucher à un compte. Il n'atteint jamais vos identifiants, vos brokers ni le mandat
        d'investissement.
      </p>

      {error !== null ? (
        <p role="alert" className="yd-connections__alert">
          {error}
        </p>
      ) : null}

      {status === null && error === null ? (
        <p className="yd-conn__hint">Lecture de l'état du connecteur…</p>
      ) : null}

      {status !== null ? (
        <>
          <p className="yd-conn__state-line" data-testid="yd-connector-state">
            {status.exists
              ? `Clé créée le ${moment(status.created_at)}${
                  status.last_used_at
                    ? `, dernière utilisation le ${moment(status.last_used_at)}`
                    : ", jamais utilisée"
                }.`
              : "Aucune clé : le connecteur ne peut pas joindre Yieldo."}
          </p>

          {created !== null ? (
            <div className="yd-connector__reveal">
              <div className="yd-connector__key-row">
                <code className="yd-connector__key" aria-label="Clé du connecteur">
                  {created}
                </code>
                <button type="button" className="yd-conn__action" onClick={copyKey}>
                  <CopyIcon />
                  {copied ? "Copiée" : "Copier"}
                </button>
              </div>
              <p className="yd-conn__hint" role="status">
                Copiez-la maintenant&nbsp;: elle ne sera plus affichée. Sur la machine d'EZLink,
                elle va dans le fichier <code>{KEY_FILE}</code> du dossier de la passerelle (voir
                le README, « Claude par EZLink »).
              </p>
            </div>
          ) : null}

          <div className="yd-conn__actions">
            <button
              type="button"
              className="yd-conn__action yd-conn__action--primary"
              onClick={createKey}
              disabled={busy}
            >
              {status.exists ? "Remplacer la clé" : "Créer la clé"}
            </button>
            {status.exists ? (
              <button type="button" className="yd-conn__action" onClick={revokeKey} disabled={busy}>
                Révoquer
              </button>
            ) : null}
          </div>
          {status.exists ? (
            <p className="yd-conn__hint">
              Remplacer la clé coupe l'ancienne aussitôt. Révoquer coupe le connecteur jusqu'à la
              prochaine clé.
            </p>
          ) : null}
        </>
      ) : null}

      {actions !== null ? (
        <section className="yd-connector__log" aria-labelledby="yd-connector-log-title">
          <h3 id="yd-connector-log-title" className="yd-connector__log-title">
            Ce que Claude a fait
          </h3>
          {actions.length === 0 ? (
            <p className="yd-conn__hint">Rien pour l'instant : aucune écriture par le connecteur.</p>
          ) : (
            <ul className="yd-connector__list">
              {actions.map((action) => {
                const pill = actionPill(action);
                return (
                  <li key={action.id} className="yd-connector__item">
                    <span className="yd-connector__what">{action.title}</span>
                    <span className="yd-connector__when">{moment(action.created_at)}</span>
                    <span className={`yd-connector__pill yd-connector__pill--${pill.tone}`}>
                      {pill.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
