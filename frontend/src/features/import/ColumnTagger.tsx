import { COLUMN_ROLES, ROLE_LABELS, type ColumnRole } from "../../lib/types";

interface ColumnTaggerProps {
  headers: string[];
  sampleRows: string[][];
  mapping: Record<number, ColumnRole>;
  onRoleChange: (columnIndex: number, role: ColumnRole) => void;
  errors: string[];
}

// The heart of the import wizard: one <select> per column, always visible above
// the preview it drives. Auto-detection only fills the initial `value` — every
// select stays enabled so the user can override anything the backend guessed,
// and nothing downstream (preview, commit) can happen without this component's
// state passing through the user's own eyes first.
export function ColumnTagger({ headers, sampleRows, mapping, onRoleChange, errors }: ColumnTaggerProps) {
  // The surface, radius and padding come from the BentoCell this sits in
  // (see ImportPage's SPAN map) -- a card inside a card would only draw a
  // second border around the same content.
  return (
    <div className="yd-tagger">
      <h2 className="yd-tagger__title">Taggez vos colonnes</h2>
      <p className="yd-tagger__intro">
        Yieldo a proposé un rôle pour chaque colonne. Corrigez-les si besoin&nbsp;: rien ne sera
        importé avant votre validation.
      </p>

      {errors.length > 0 && (
        <div role="alert" className="yd-tagger__alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="yd-tagger__scroll">
        <table className="yd-tagger__table">
          <thead>
            <tr>
              {headers.map((header, index) => {
                const trimmed = header.trim();
                const displayName = trimmed || `colonne ${index + 1}`;
                const inputId = `column-role-${index}`;
                return (
                  <th key={index} className="yd-tagger__column">
                    <label htmlFor={inputId} className="yd-tagger__label">
                      {trimmed || `Colonne ${index + 1}`}
                    </label>
                    <select
                      id={inputId}
                      aria-label={trimmed ? `Rôle de la colonne "${trimmed}"` : `Rôle de la colonne ${index + 1}`}
                      value={mapping[index] ?? "ignore"}
                      onChange={(event) => onRoleChange(index, event.target.value as ColumnRole)}
                      className="yd-tagger__select"
                    >
                      {COLUMN_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    <span className="sr-only">Aperçu de {displayName}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sampleRows.slice(0, 5).map((row, rowIndex) => (
              <tr key={rowIndex} className="yd-tagger__row">
                {headers.map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="yd-tagger__cell yd-num"
                    data-ignored={mapping[columnIndex] === "ignore" || undefined}
                  >
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
