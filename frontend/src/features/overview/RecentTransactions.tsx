import { Link } from "react-router";

import { EmptyState } from "../../design/EmptyState";
import { ListIcon } from "../../design/icons";
import { formatCents } from "../../design/theme";
import type { Category, Transaction } from "../../lib/types";

interface RecentTransactionsProps {
  rows: Transaction[];
  /** Used to name and tint a row's category. An id with no category in this
   *  list falls back to "Non catégorisé", which is what it is. */
  categories: Category[];
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The last few operations, beside the calendar that counts them.
 *
 * Four columns and no more: the date, the label, the category as a tinted
 * pill, the amount. Everything else a transaction carries — the account, the
 * source of its category, its tags — is on /transactions, and the link in this
 * panel's head is how you get there. A dashboard panel that reproduced the
 * whole table would be a second transactions screen with five rows in it.
 */
export function RecentTransactions({ rows, categories }: RecentTransactionsProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ListIcon}
        title="Aucune opération sur cette période."
        detail="Changez la période ci-dessus, ou importez un relevé."
      >
        <Link to="/import" className="yd-empty__action">
          Importer un relevé
        </Link>
      </EmptyState>
    );
  }

  const byId = new Map(categories.map((category) => [category.id, category]));

  return (
    <ul className="yd-recent">
      {rows.map((row) => {
        const category = row.category_id === null ? undefined : byId.get(row.category_id);
        return (
          <li key={row.id} className="yd-recent__row">
            <span className="yd-recent__date">{shortDate(row.date)}</span>
            <span className="yd-recent__label">{row.label_clean || row.label_raw}</span>
            <span
              className="yd-recent__category"
              // The category's own colour, at the alpha a pill takes. Inline
              // because the colour comes from the user's data, not from the
              // palette — there is no class that could carry it.
              style={
                category
                  ? {
                      color: category.color,
                      borderColor: `color-mix(in srgb, ${category.color} 34%, transparent)`,
                      background: `color-mix(in srgb, ${category.color} 14%, transparent)`,
                    }
                  : undefined
              }
            >
              {category?.name ?? "Non catégorisé"}
            </span>
            <span
              className={`yd-recent__amount yd-num${row.amount_cents < 0 ? "" : " yd-recent__amount--in"}`}
            >
              {formatCents(row.amount_cents, { signed: true })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
