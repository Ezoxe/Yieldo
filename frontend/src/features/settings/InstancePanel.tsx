import { useEffect, useState } from "react";

import { ApiError, api } from "../../lib/api";
import type { InstanceSettings } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * Admin only: whether this installation takes new accounts.
 *
 * Registration ships closed once the first account exists. The administrator
 * opens it for the time another member of the household creates an account,
 * then closes it again; nothing else on the installation is shared by it.
 */
export function InstancePanel() {
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<InstanceSettings>("/admin/settings")
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(open: boolean) {
    setError(null);
    setSaving(true);
    try {
      setSettings(await api.patch<InstanceSettings>("/admin/settings", { registration_open: open }));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="yd-settings__instance">
      {settings !== null ? (
        <div className="yd-settings__field yd-settings__field--switch">
          <label htmlFor="settings-registration">
            Autoriser la création d'autres comptes sur cette installation
          </label>
          <input
            id="settings-registration"
            type="checkbox"
            role="switch"
            checked={settings.registration_open}
            aria-checked={settings.registration_open}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
          />
        </div>
      ) : null}
      <p className="yd-settings__note">
        Fermé, personne ne peut créer de compte après le vôtre. Ouvrez le temps qu'un membre du
        foyer crée le sien, puis refermez&nbsp;: chaque compte garde ses propres données, que les
        autres ne voient pas.
      </p>
      {error !== null ? (
        <p role="alert" className="yd-account__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
