import { formatCents } from "../../design/theme";
import type { Category, PreviewRow } from "../../lib/types";
import "./ImportPage.css";

interface PreviewTableProps {
  rows: PreviewRow[];
  categories: Category[];
  overrides: Record<number, number>;
  keepDuplicates: number[];
  onOverrideCategory: (rowNumber: number, categoryId: number) => void;
  onToggleKeepDuplicate: (rowNumber: number) => void;
}

// "builtin" and "rule" both mean "matched a rule": "builtin" additionally says the
// rule shipped with Yieldo rather than being written by the user (see the comment
// on TRANSACTION_CATEGORY_SOURCES in backend/app/models/transaction.py) — both
// read as the same "Règle" chip here, since that distinction has no user-facing
// meaning in an import preview.
const SOURCE_LABELS: Record<string, string> = {
  builtin: "Règle",
  rule: "Règle",
  learned: "Apprise",
  manual: "Manuelle",
  csv: "CSV",
  uncategorized: "Non catégorisée",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("fr-FR");
}

// The class prefix is `yd-import-preview`, not `yd-preview`: the landing page's
// DashboardPreview owns `.yd-preview` and its own `__category`, and since Vite
// bundles every component stylesheet into one document the two blocks were
// silently overriding each other's display and padding.
export function PreviewTable({
  rows,
  categories,
  overrides,
  keepDuplicates,
  onOverrideCategory,
  onToggleKeepDuplicate,
}: PreviewTableProps) {
  return (
    <div className="yd-import-preview">
      <h2 className="yd-import-preview__title">Aperçu des lignes</h2>

      <div className="yd-import-preview__scroll">
        <table className="yd-import-preview__table">
          <thead>
            <tr>
              <th scope="col">Ligne</th>
              <th scope="col">Date</th>
              <th scope="col">Libellé</th>
              <th scope="col">Montant</th>
              <th scope="col">Catégorie</th>
              <th scope="col">Origine</th>
              <th scope="col">Doublon</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.error) {
                return (
                  <tr
                    key={row.row_number}
                    className="yd-import-preview__row yd-import-preview__row--error"
                  >
                    <td className="yd-num">{row.row_number}</td>
                    <td colSpan={6} role="alert">
                      Ligne {row.row_number} ignorée&nbsp;: {row.error}
                    </td>
                  </tr>
                );
              }

              const category = categories.find((candidate) => candidate.id === row.category_id);
              const overrideValue = overrides[row.row_number] ?? row.category_id ?? "";
              const sourceLabel = SOURCE_LABELS[row.category_source] ?? row.category_source;
              const keptDuplicate = keepDuplicates.includes(row.row_number);

              return (
                <tr
                  key={row.row_number}
                  className="yd-import-preview__row"
                  data-duplicate={row.is_duplicate || undefined}
                >
                  <td className="yd-num">{row.row_number}</td>
                  <td className="yd-num">{formatDate(row.date)}</td>
                  <td className="yd-import-preview__label">{row.label_raw}</td>
                  <td className="yd-num yd-import-preview__amount">
                    {row.amount_cents !== null ? formatCents(row.amount_cents, { signed: true }) : "—"}
                  </td>
                  <td>
                    <span className="yd-import-preview__category">
                      <span
                        className="yd-import-preview__dot"
                        aria-hidden="true"
                        style={{ background: category?.color ?? "var(--yd-text-muted)" }}
                      />
                      <label>
                        <span className="sr-only">Catégorie de la ligne {row.row_number}</span>
                        <select
                          value={overrideValue}
                          onChange={(event) =>
                            onOverrideCategory(row.row_number, Number(event.target.value))
                          }
                        >
                          <option value="" disabled>
                            Non catégorisée
                          </option>
                          {categories.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </span>
                  </td>
                  <td>
                    <span className="yd-import-preview__badge">{sourceLabel}</span>
                  </td>
                  <td>
                    {row.is_duplicate ? (
                      <label className="yd-import-preview__keep">
                        <input
                          type="checkbox"
                          checked={keptDuplicate}
                          onChange={() => onToggleKeepDuplicate(row.row_number)}
                        />
                        Importer quand même
                      </label>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
