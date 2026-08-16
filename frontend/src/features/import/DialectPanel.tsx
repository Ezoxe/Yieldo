import { useState } from "react";

import type { ColumnProfile, CsvDialect } from "../../lib/types";
import "./ImportPage.css";

interface DialectPanelProps {
  dialect: CsvDialect | null;
  profiles: ColumnProfile[];
  isBusy: boolean;
  /**
   * What the last change to this panel threw away, in French, or null. Rendered
   * here rather than at the top of the step: someone who has just nudged the
   * preamble spinner is looking at the spinner.
   */
  discardNotice: string | null;
  onDismissDiscardNotice: () => void;
  onFieldChange: (field: keyof CsvDialect, value: string | number) => void;
  onSaveProfile: (name: string) => void;
  onApplyProfile: (profile: ColumnProfile) => void;
}

const ENCODING_OPTIONS = ["utf-8", "utf-8-sig", "cp1252", "latin-1", "utf-16"];

const DELIMITER_OPTIONS = [
  { value: ";", label: "Point-virgule ( ; )" },
  { value: ",", label: "Virgule ( , )" },
  { value: "\t", label: "Tabulation" },
  { value: "|", label: "Barre verticale ( | )" },
];

const DECIMAL_OPTIONS = [
  { value: ",", label: "Virgule ( , )" },
  { value: ".", label: "Point ( . )" },
];

const DATE_FORMAT_OPTIONS = [
  "%d/%m/%Y",
  "%d/%m/%y",
  "%Y-%m-%d",
  "%m/%d/%Y",
  "%d-%m-%Y",
  "%d.%m.%Y",
];

// Every field here is a *proposal* the backend detected (see detect_dialect in
// backend/app/importers/dialect.py) — same rule as the column mapping: the user
// sees it, may override it, and any change is re-analyzed before it is trusted.
export function DialectPanel({
  dialect,
  profiles,
  isBusy,
  discardNotice,
  onDismissDiscardNotice,
  onFieldChange,
  onSaveProfile,
  onApplyProfile,
}: DialectPanelProps) {
  const [namingProfile, setNamingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");

  if (!dialect) return null;

  function handleSave() {
    const trimmed = profileName.trim();
    if (!trimmed) return;
    onSaveProfile(trimmed);
    setProfileName("");
    setNamingProfile(false);
  }

  // Plain content: the BentoCell around it is the surface (see ColumnTagger).
  return (
    <div className="yd-dialect">
      <h2 className="yd-dialect__title">Format du fichier</h2>
      <p className="yd-dialect__intro">
        Détecté automatiquement. Ajustez si l'aperçu ne correspond pas à votre relevé&nbsp;: chaque
        changement relance l'analyse.
      </p>

      <div className="yd-dialect__grid">
        <label className="yd-dialect__field">
          <span>Encodage</span>
          <select
            value={dialect.encoding}
            disabled={isBusy}
            onChange={(event) => onFieldChange("encoding", event.target.value)}
          >
            {ENCODING_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="yd-dialect__field">
          <span>Séparateur de colonnes</span>
          <select
            value={dialect.delimiter}
            disabled={isBusy}
            onChange={(event) => onFieldChange("delimiter", event.target.value)}
          >
            {DELIMITER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="yd-dialect__field">
          <span>Séparateur décimal</span>
          <select
            value={dialect.decimal_separator}
            disabled={isBusy}
            onChange={(event) => onFieldChange("decimal_separator", event.target.value)}
          >
            {DECIMAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="yd-dialect__field">
          <span>Format de date</span>
          <select
            value={dialect.date_format}
            disabled={isBusy}
            onChange={(event) => onFieldChange("date_format", event.target.value)}
          >
            {DATE_FORMAT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="yd-dialect__field">
          <span>Lignes de préambule</span>
          <input
            type="number"
            min={0}
            value={dialect.preamble_rows}
            disabled={isBusy}
            onChange={(event) => onFieldChange("preamble_rows", Number(event.target.value))}
          />
        </label>
      </div>

      {/* role="status" (aria-live polite): the choices vanish without any other
          visible change, so this has to be announced, not merely displayed. */}
      {discardNotice ? (
        <div role="status" className="yd-dialect__notice">
          <p className="yd-dialect__notice-text">{discardNotice}</p>
          <button type="button" className="yd-dialect__notice-dismiss" onClick={onDismissDiscardNotice}>
            Fermer
          </button>
        </div>
      ) : null}

      <div className="yd-dialect__profiles">
        {profiles.length > 0 ? (
          <label className="yd-dialect__field">
            <span>Profil enregistré</span>
            <select
              defaultValue=""
              disabled={isBusy}
              onChange={(event) => {
                const chosen = profiles.find((profile) => String(profile.id) === event.target.value);
                if (chosen) onApplyProfile(chosen);
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Choisir un profil…
              </option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {namingProfile ? (
          <div className="yd-dialect__save-row">
            <label>
              <span className="sr-only">Nom du profil</span>
              <input
                type="text"
                placeholder="Nom du profil"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </label>
            <button type="button" onClick={handleSave} disabled={!profileName.trim()}>
              Confirmer
            </button>
            <button type="button" className="yd-dialect__cancel" onClick={() => setNamingProfile(false)}>
              Annuler
            </button>
          </div>
        ) : (
          <button type="button" className="yd-dialect__save" onClick={() => setNamingProfile(true)}>
            Enregistrer ce profil
          </button>
        )}
      </div>
    </div>
  );
}
