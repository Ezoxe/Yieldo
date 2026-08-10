import { useNavigate } from "react-router";

import { useDensity } from "../../app/DensityProvider";
import { useTheme } from "../../app/ThemeProvider";
import { useMotionPreference } from "../../design/motion/motionPreference";
import type { DensityPreference, ThemePreference } from "../../design/theme";
import { useSession } from "../auth/session";
import "./SettingsPage.css";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Système" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];

const DENSITY_OPTIONS: { value: DensityPreference; label: string }[] = [
  { value: "comfortable", label: "Confortable" },
  { value: "compact", label: "Compact" },
];

// Phase 1's Réglages screen is deliberately small: theme, density, an
// animation kill switch, and signing out. Registration open/close is out of
// scope here — `registration_open` is an environment variable read once at
// startup with no endpoint to change it; exposing it needs a server-side
// settings table that belongs to phase 3 alongside API-key management.
export function SettingsPage() {
  const { preference: theme, setPreference: setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  const motionDisabled = useMotionPreference((state) => state.disabled);
  const setMotionDisabled = useMotionPreference((state) => state.setDisabled);
  const userName = useSession((state) => state.user?.name ?? "");
  const logout = useSession((state) => state.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/connexion", { replace: true });
  }

  return (
    <section className="yd-settings">
      <h1>Réglages</h1>
      <p className="yd-settings__intro">Connecté en tant que {userName}.</p>

      <div className="yd-settings__field">
        <label htmlFor="settings-theme">Thème</label>
        <select
          id="settings-theme"
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemePreference)}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="yd-settings__field">
        <label htmlFor="settings-density">Densité d'affichage</label>
        <select
          id="settings-density"
          value={density}
          onChange={(event) => setDensity(event.target.value as DensityPreference)}
        >
          {DENSITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="yd-settings__field yd-settings__field--switch">
        <label htmlFor="settings-animations">Activer les animations</label>
        <input
          id="settings-animations"
          type="checkbox"
          role="switch"
          checked={!motionDisabled}
          aria-checked={!motionDisabled}
          onChange={(event) => setMotionDisabled(!event.target.checked)}
        />
      </div>

      <button type="button" className="yd-settings__logout" onClick={handleLogout}>
        Se déconnecter
      </button>
    </section>
  );
}
