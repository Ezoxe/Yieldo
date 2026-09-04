import { motion } from "motion/react";
import { Link, useNavigate } from "react-router";

import { useDensity } from "../../app/DensityProvider";
import { useTheme } from "../../app/ThemeProvider";
import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import {
  AccountIcon,
  AppearanceIcon,
  ChevronIcon,
  ConnectionsIcon,
  KeyIcon,
  LockIcon,
  SettingsIcon,
  SignOutIcon,
} from "../../design/icons";
import { useMotionPreference } from "../../design/motion/motionPreference";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { PageHead } from "../../design/PageHead";
import type { DensityPreference, ThemePreference } from "../../design/theme";
import { useSession } from "../auth/session";
import { AccessKeyPanel } from "./AccessKeyPanel";
import { PasswordForm } from "./PasswordForm";
import { ProfileForm } from "./ProfileForm";
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

/**
 * Two columns from 1200px: the account on the left, everything that is a
 * preference on the right. The account is the half that writes to the
 * database; apparence, connexions and the way out are the half that does not.
 */
const SPAN = {
  half: { base: 1, md: 6, lg: 6 },
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

// Le compte, l'apparence, un interrupteur d'animation, et la déconnexion. Les
// clés de marché et le modèle de langage vivent sur leur propre écran,
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
  const reduced = useReducedMotion();

  async function handleLogout() {
    await logout();
    navigate("/connexion", { replace: true });
  }

  return (
    <section className="yd-settings">
      <PageHead icon={SettingsIcon} title="Réglages">
        <p className="yd-settings__intro">Connecté en tant que {userName}.</p>
      </PageHead>

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={AccountIcon}>Votre compte</PanelHead>
          <ProfileForm />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={LockIcon}>Mot de passe</PanelHead>
          <PasswordForm />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={AppearanceIcon}>Apparence</PanelHead>

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
        </BentoCell>

        {/* Pleine largeur : c'est le panneau le plus dense de l'écran depuis
            qu'il montre le brief qu'un agent reçoit. Une centaine de lignes de
            texte technique dans une demi-colonne ne se relit pas. */}
        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={KeyIcon} tone="warning">
            Accès par API
          </PanelHead>
          <AccessKeyPanel />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={ConnectionsIcon}>Connexions</PanelHead>
          <p className="yd-settings__note">
            Rien n'y est obligatoire&nbsp;: sans aucune clé, Yieldo importe, catégorise, budgète,
            projette et répond. Une clé s'y écrit et ne s'y relit jamais.
          </p>
          <Link className="yd-settings__link" to="/reglages/connexions">
            Clés de données de marché et modèle de langage
            <ChevronIcon />
          </Link>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={SignOutIcon} tone="negative">
            Fin de session
          </PanelHead>
          <p className="yd-settings__note">
            Vos données restent sur cette machine. Se déconnecter ne supprime rien&nbsp;: il faudra
            simplement vous identifier à nouveau.
          </p>
          <button type="button" className="yd-settings__logout" onClick={handleLogout}>
            <SignOutIcon />
            Se déconnecter
          </button>
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
