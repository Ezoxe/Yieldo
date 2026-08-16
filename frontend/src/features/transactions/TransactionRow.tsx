import { formatCents } from "../../design/theme";
import type { Category, Transaction } from "../../lib/types";

// Mirrors TRANSACTION_CATEGORY_SOURCES in backend/app/models/transaction.py.
const SOURCE_HINTS: Record<string, string> = {
  builtin: "Catégorie déduite d'une règle intégrée",
  rule: "Catégorie déduite d'une règle intégrée",
  learned: "Catégorie déduite d'une règle apprise de vos corrections",
  manual: "Catégorie choisie par vous",
  csv: "Catégorie fournie par le fichier importé",
  uncategorized: "Aucune catégorie",
};

const SOURCE_BADGES: Record<string, string> = {
  builtin: "règle",
  rule: "règle",
  learned: "apprise",
  manual: "manuelle",
  csv: "CSV",
  uncategorized: "—",
};

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  onRecategorize: (transactionId: number, categoryId: number | null) => void;
}

export function TransactionRow({ transaction, categories, onRecategorize }: TransactionRowProps) {
  const category = categories.find((candidate) => candidate.id === transaction.category_id);
  const isCredit = transaction.amount_cents > 0;
  const parents = categories.filter((candidate) => candidate.parent_id === null);
  const sourceHint = SOURCE_HINTS[transaction.category_source] ?? transaction.category_source;
  const sourceBadge = SOURCE_BADGES[transaction.category_source] ?? transaction.category_source;

  return (
    <tr className="yd-transactions__row">
      <td className="yd-num yd-transactions__cell yd-transactions__cell--date">
        {new Date(transaction.date).toLocaleDateString("fr-FR")}
      </td>
      <td className="yd-transactions__cell yd-transactions__cell--label">
        {/* label_raw, never label_clean: the user must recognize the line
            exactly as it reads on their own bank statement. */}
        <span>{transaction.label_raw}</span>
      </td>
      <td className="yd-transactions__cell yd-transactions__cell--category">
        <label className="sr-only" htmlFor={`category-${transaction.id}`}>
          Catégorie
        </label>
        <div className="yd-transactions__category">
          <span
            aria-hidden="true"
            className="yd-transactions__dot"
            style={{ background: category?.color ?? "var(--yd-text-muted)" }}
          />
          <select
            id={`category-${transaction.id}`}
            aria-label="Catégorie"
            value={transaction.category_id ?? ""}
            onChange={(event) => {
              // The empty option is "Non catégorisé": Number("") coerces to 0, which
              // the backend would read as a real (nonexistent) category id and reject
              // with a 404. Send null explicitly so the backend clears the category
              // instead.
              const raw = event.target.value;
              onRecategorize(transaction.id, raw === "" ? null : Number(raw));
            }}
            className="yd-transactions__select"
          >
            <option value="">Non catégorisé</option>
            {parents.map((parent) => (
              <optgroup key={parent.id} label={parent.name}>
                <option value={parent.id}>{parent.name}</option>
                {categories
                  .filter((child) => child.parent_id === parent.id)
                  .map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <span className="yd-transactions__badge" title={sourceHint}>
            {sourceBadge}
          </span>
        </div>
      </td>
      <td className="yd-transactions__cell yd-transactions__cell--amount">
        {/* Both tones are carried by the class, in TransactionsPage.css. They
            used to come from an inline style, which no theme and no stylesheet
            could reach -- and `.yd-amount--negative` matched no rule at all. */}
        <span className={`yd-num ${isCredit ? "yd-amount--positive" : "yd-amount--negative"}`}>
          {formatCents(transaction.amount_cents)}
        </span>
      </td>
    </tr>
  );
}
