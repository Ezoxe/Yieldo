import { useState } from "react";

import { SignOutIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import type { User } from "../../lib/types";
import { applySession } from "../auth/session";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * Ends every session but this one: other browsers, forgotten tabs, and the
 * agent key. The backend bumps the session version and hands this tab a
 * fresh session, applied here so the reader stays signed in.
 */
export function SessionsPanel() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const session = await api.post<{ access_token: string; user: User }>(
        "/auth/sessions/revoke-others",
      );
      applySession(session);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yd-settings__sessions">
      <p className="yd-settings__note">
        Un appareil oublié, un navigateur prêté&nbsp;: ce bouton ferme toutes les sessions sauf
        celle-ci, et retire la clé d'accès de l'agent. Une nouvelle clé s'affiche à votre prochaine
        visite de Réglages.
      </p>
      {error !== null ? (
        <p role="alert" className="yd-account__error">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="yd-account__saved">
          Les autres appareils sont déconnectés.
        </p>
      ) : null}
      <button
        type="button"
        className="yd-settings__logout"
        onClick={() => void revoke()}
        disabled={busy}
      >
        <SignOutIcon />
        {busy ? "Déconnexion…" : "Déconnecter les autres appareils"}
      </button>
    </div>
  );
}
