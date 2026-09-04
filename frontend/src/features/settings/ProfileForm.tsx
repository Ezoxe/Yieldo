import { useState, type FormEvent } from "react";

import { SaveIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import type { User } from "../../lib/types";
import { useSession } from "../auth/session";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * Name and email, on the account the reader is signed in with.
 *
 * The email is not cosmetic: it is the key `POST /auth/login` looks an account
 * up by, so changing it here changes what has to be typed to sign in next
 * time. The form says so rather than letting the operator find out at the
 * login screen.
 */
export function ProfileForm() {
  const user = useSession((state) => state.user);
  const setUser = useSession((state) => state.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== (user?.name ?? "") || email.trim() !== (user?.email ?? "");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      // Only what actually changed goes on the wire. Sending the unchanged
      // email back would make the backend run its uniqueness check against the
      // account's own row on every save — which it handles, but there is no
      // reason to ask it.
      const patch: { name?: string; email?: string } = {};
      if (name.trim() !== user?.name) patch.name = name.trim();
      if (email.trim() !== user?.email) patch.email = email.trim();
      const updated = await api.patch<User>("/auth/me", patch);
      setUser(updated);
      setName(updated.name);
      setEmail(updated.email);
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
        <span>Nom</span>
        <input
          type="text"
          value={name}
          autoComplete="name"
          required
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <label className="yd-account__field">
        <span>Adresse email</span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(event) => {
            setEmail(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <p className="yd-account__note">
        L'adresse email est aussi votre identifiant de connexion&nbsp;: si vous la changez, c'est
        la nouvelle qu'il faudra saisir pour vous reconnecter.
      </p>

      {error !== null ? (
        <p role="alert" className="yd-account__error">
          {error}
        </p>
      ) : null}

      {saved ? (
        // `role="status"`, not `alert`: nothing went wrong, and an assertive
        // announcement for a successful save interrupts what the reader is
        // doing to tell them it worked.
        <p role="status" className="yd-account__saved">
          Profil enregistré.
        </p>
      ) : null}

      <button type="submit" className="yd-account__submit" disabled={saving || !dirty}>
        <SaveIcon />
        {saving ? "Enregistrement…" : "Enregistrer le profil"}
      </button>
    </form>
  );
}
