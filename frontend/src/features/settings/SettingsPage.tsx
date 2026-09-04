import { Link, useNavigate } from "react-router";

import { useDensity } from "../../app/DensityProvider";
import { useTheme } from "../../app/ThemeProvider";
import { useMotionPreference } from "../../design/motion/motionPreference";
import type { DensityPreference, ThemePreference } from "../../design/theme";
import { useSession } from "../auth/session";
import "./SettingsPage.css";
import { SettingsIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Système" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];

const DENSITY_OPTIONS: { value: DensityPreference; label: string }[] = [
  { value: "comfortable", label: "Confortable" },
  { value: "compact", label: "Compact" },
];

// Théme, densité, un interrupteur d'animation, et la déconnexion. Les clés
// de marché et le modèle de langage vivent sur leur propre écran,
// /reglages/connexions — c'est l'adresse que nomment toutes les phrases
// françaises de `market/client.py` et `llm/client.py`, et un écran séparé est
// ce qui rend cette adresse atteignable. Registration open/close reste hors
// périmètre : `registration_open` est une variable d'environnement lue au
// démarrage, sans endpoint pour la changer.
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
      <PageHead icon={SettingsIcon} title="Réglages">
        <p className="yd-settings__intro">Connecté en tant que {userName}.</p>
      </PageHead>

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

      <div className="yd-settings__field yd-settings__field--link">
        <Link className="yd-settings__link" to="/reglages/connexions">
          Connexions — clés de données de marché et modèle de langage
        </Link>
        <p className="yd-settings__note">
          Rien n'y est obligatoire&nbsp;: sans aucune clé, Yieldo importe, catégorise, budgète,
          projette et répond. Une clé s'y écrit et ne s'y relit jamais.
        </p>
      </div>

      <button type="button" className="yd-settings__logout" onClick={handleLogout}>
        Se déconnecter
      </button>
    </section>
  );
}
