import { useEffect, useState } from "react";

import { CopyIcon, EyeIcon, EyeOffIcon, RefreshIcon, TrashIcon } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { ApiError, api } from "../../lib/api";
import type { AgentKey } from "../../lib/types";
import { SESSION_ONLY_ROUTES, buildAgentBrief } from "./agentBrief";

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
  // Which of the two copies just happened, so the confirmation says which.
  const [copied, setCopied] = useState<"key" | "brief" | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
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
    setCopied(null);
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
    setCopied(null);
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

  /**
   * The two things worth copying.
   *
   * The key alone is what a program already configured for Yieldo needs. The
   * brief is what an agent that has never seen Yieldo needs — the address, the
   * header, the expiry, the conventions and the routes — because a key on its
   * own tells an agent nothing about where to send it or what a figure means.
   */
  async function copy(what: "key" | "brief") {
    if (key === null) return;
    const text =
      what === "key"
        ? key.key
        : buildAgentBrief({
            key: key.key,
            expiresAt: key.expires_at,
            origin: window.location.origin,
          });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      // A clipboard a browser refuses is not an error worth a red panel: both
      // are one click from being visible and selectable by hand.
      setRevealed(true);
      setBriefOpen(what === "brief");
      setError(
        what === "brief"
          ? "Le presse-papiers est indisponible : le brief est affiché ci-dessous, copiez-le à la main."
          : "Le presse-papiers est indisponible : la clé est affichée, copiez-la à la main.",
      );
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
              onClick={() => void copy("key")}
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
                  {SESSION_ONLY_ROUTES.length} routes lui restent fermées et exigent une vraie
                  session&nbsp;: changer le mot de passe, changer l'email, lire cette clé, la
                  renouveler, la révoquer, et les trois routes des clés de Réglages →
                  Connexions. Un agent ne peut pas vous verrouiller dehors.
                </span>
              </span>
            </InfoTip>
          </p>

          {copied !== null ? (
            <p role="status" className="yd-account__saved">
              {copied === "key" ? "Clé copiée." : "Brief complet copié."}
            </p>
          ) : null}

          {/* The brief: everything an agent needs in one paste. Offered beside
              the key rather than instead of it — a program already configured
              for Yieldo wants the key alone. */}
          <div className="yd-key__brief">
            <div className="yd-key__brief-head">
              <button
                type="button"
                className="yd-account__submit"
                onClick={() => void copy("brief")}
              >
                <CopyIcon />
                Copier le brief complet
              </button>
              <button
                type="button"
                className="yd-key__brief-toggle"
                aria-expanded={briefOpen}
                onClick={() => setBriefOpen((open) => !open)}
              >
                {briefOpen ? "Masquer" : "Voir ce qui sera copié"}
              </button>
            </div>
            <p className="yd-key__brief-note">
              L'adresse de cette instance, l'en-tête d'authentification, l'échéance, les
              conventions de Yieldo (montants en centimes, dates ISO) et les points d'entrée de
              l'API. De quoi permettre à un agent qui n'a jamais vu Yieldo de commencer sans rien deviner.
              Aucun mot de passe&nbsp;: l'API n'en accepte aucun, la clé suffit.
            </p>
            {briefOpen ? (
              <pre className="yd-key__brief-text">
                {buildAgentBrief({
                  key: revealed ? key.key : "yld_" + "•".repeat(28),
                  expiresAt: key.expires_at,
                  origin: window.location.origin,
                })}
              </pre>
            ) : null}
          </div>

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
