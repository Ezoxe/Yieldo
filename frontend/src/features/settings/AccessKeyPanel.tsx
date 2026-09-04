import { useEffect, useState } from "react";

import { CopyIcon, EyeIcon, EyeOffIcon, RefreshIcon, TrashIcon } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { ApiError, api } from "../../lib/api";
import type { AgentKey } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** How long the key has left, in the words a person would use. */
export function remainingLabel(expiresAt: string, now: Date = new Date()): string {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (Number.isNaN(ms)) return "échéance inconnue";
  if (ms <= 0) return "expirée";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours === 0) return `expire dans ${minutes} min`;
  return `expire dans ${hours} h ${String(minutes).padStart(2, "0")}`;
}

/** When it was last used, or the fact that it never has been. */
export function lastUsedLabel(lastUsedAt: string | null): string {
  if (lastUsedAt === null) return "jamais utilisée";
  return `dernière utilisation le ${new Date(lastUsedAt).toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * The key an agent uses, and the three things an operator does with it: read
 * it, replace it, remove it.
 *
 * Masked until asked for. Not security theatre — the panel sits on a screen an
 * operator opens in front of other people, and a credential printed in full on
 * a dashboard is a credential over a shoulder. Revealing it is one click, and
 * copying it does not require revealing it at all.
 */
export function AccessKeyPanel() {
  const [key, setKey] = useState<AgentKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A GET, and a GET only: reading the panel must never rotate the key an
    // agent is already using. The backend issues one here if there is none or
    // the last has run out — see `app/api/agent_keys.py`.
    api
      .get<AgentKey>("/access-key")
      .then((body) => {
        if (!cancelled) setKey(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function rotate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setKey(await api.post<AgentKey>("/access-key/rotate"));
      setRevealed(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      await api.delete("/access-key");
      setKey(null);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    setBusy(true);
    setError(null);
    try {
      setKey(await api.get<AgentKey>("/access-key"));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (key === null) return;
    try {
      await navigator.clipboard.writeText(key.key);
      setCopied(true);
    } catch {
      // A clipboard a browser refuses is not an error worth a red panel: the
      // key is one click from being visible and selectable by hand.
      setRevealed(true);
      setError("Le presse-papiers est indisponible : la clé est affichée, copiez-la à la main.");
    }
  }

  return (
    <>
      <p className="yd-account__note">
        Une clé unique, valable <strong>24 heures</strong>, qui donne à un programme les mêmes
        droits que vous sur vos données&nbsp;: tout lire, et tout modifier. Passée l'échéance elle
        n'authentifie plus rien et la suivante s'affiche ici.
      </p>

      {error !== null ? (
        <p role="alert" className="yd-account__error">
          {error}
        </p>
      ) : null}

      {key === null ? (
        <>
          <p className="yd-account__note">
            Aucune clé active&nbsp;: aucun programme ne peut accéder à ce compte.
          </p>
          <button
            type="button"
            className="yd-account__submit"
            onClick={reissue}
            disabled={busy}
          >
            <RefreshIcon />
            Émettre une clé
          </button>
        </>
      ) : (
        <>
          <div className="yd-key">
            <code className="yd-key__value">
              {revealed ? key.key : "yld_" + "•".repeat(28)}
            </code>
            <button
              type="button"
              className="yd-key__action"
              aria-label={revealed ? "Masquer la clé" : "Afficher la clé"}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
            <button
              type="button"
              className="yd-key__action"
              aria-label="Copier la clé"
              onClick={copy}
            >
              <CopyIcon />
            </button>
          </div>

          <p className="yd-key__meta">
            <span className="yd-key__chip">{remainingLabel(key.expires_at)}</span>
            <span>{lastUsedLabel(key.last_used_at)}</span>
            <InfoTip label="Comment se servir de cette clé">
              <span className="yd-key__howto">
                <span>
                  Envoyez-la dans l'en-tête <code>Authorization: Bearer &lt;clé&gt;</code> sur
                  n'importe quelle route de l'API.
                </span>
                <span>
                  La description complète de l'API, route par route, est servie par Yieldo
                  lui-même&nbsp;: <code>/api/openapi.json</code>, et <code>/api/docs</code> pour la
                  version lisible.
                </span>
                <span>
                  Cinq routes lui restent fermées, et exigent une vraie session&nbsp;: changer le
                  mot de passe, changer l'email, lire cette clé, la renouveler, la révoquer, et les
                  clés de Réglages → Connexions. Un agent ne peut pas vous verrouiller dehors.
                </span>
              </span>
            </InfoTip>
          </p>

          {copied ? (
            <p role="status" className="yd-account__saved">
              Clé copiée.
            </p>
          ) : null}

          <div className="yd-key__buttons">
            <button type="button" className="yd-account__submit" onClick={rotate} disabled={busy}>
              <RefreshIcon />
              Renouveler maintenant
            </button>
            <button type="button" className="yd-key__revoke" onClick={revoke} disabled={busy}>
              <TrashIcon />
              Révoquer
            </button>
          </div>
        </>
      )}
    </>
  );
}
