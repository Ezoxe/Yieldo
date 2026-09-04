import { useState, type FormEvent } from "react";

import { SaveIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** The backend's own floor (`PasswordChangeIn.new_password`, min_length 8),
 *  repeated here only so the form can refuse before the round trip. The
 *  backend still checks it — this is a courtesy, never the guard. */
const MIN_LENGTH = 8;

/**
 * Changing the account's password.
 *
 * The current password is asked for even though the reader is already signed
 * in: an unattended session must not be enough to lock its owner out. The
 * backend verifies it again — this form never decides anything on its own.
 *
 * The confirmation field is the one check that lives ONLY here. The backend
 * cannot tell a typo from an intention, and a mistyped new password would
 * otherwise be discovered at the next login, with no way back.
 */
export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const filled = current !== "" && next !== "" && confirm !== "";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (next.length < MIN_LENGTH) {
      setError(`Le nouveau mot de passe doit faire au moins ${MIN_LENGTH} caractères.`);
      return;
    }
    if (next !== confirm) {
      setError("La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }

    setSaving(true);
    try {
      await api.post("/auth/password", { current_password: current, new_password: next });
      // Cleared on success, all three: a form still holding the old and the new
      // password after a successful change is a password left on screen.
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="yd-account__form" onSubmit={handleSubmit}>
      <label className="yd-account__field">
        <span>Mot de passe actuel</span>
        <input
          type="password"
          value={current}
          autoComplete="current-password"
          required
          onChange={(event) => {
            setCurrent(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <label className="yd-account__field">
        <span>Nouveau mot de passe</span>
        <input
          type="password"
          value={next}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          onChange={(event) => {
            setNext(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <label className="yd-account__field">
        <span>Confirmer le nouveau mot de passe</span>
        <input
          type="password"
          value={confirm}
          autoComplete="new-password"
          required
          onChange={(event) => {
            setConfirm(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <p className="yd-account__note">
        Au moins {MIN_LENGTH} caractères. Vos sessions déjà ouvertes, celle-ci comprise, restent
        actives&nbsp;: Yieldo ne vous déconnecte pas parce que vous avez changé de mot de passe.
      </p>

      {error !== null ? (
        <p role="alert" className="yd-account__error">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p role="status" className="yd-account__saved">
          Mot de passe modifié.
        </p>
      ) : null}

      <button type="submit" className="yd-account__submit" disabled={saving || !filled}>
        <SaveIcon />
        {saving ? "Enregistrement…" : "Changer le mot de passe"}
      </button>
    </form>
  );
}
