import type { ReactNode } from "react";

import type { History } from "../lib/types";
import "./EmptyState.css";

/**
 * French writes the first of the month "1er"; every other day is a bare
 * numeral. Intl has no option for it, so the ordinal is applied here.
 */
export function frenchDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  const rest = date.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${day === 1 ? "1er" : day} ${rest}`;
}

/**
 * Where the user's data actually is, in a sentence. "Vos 197 opérations vont du
 * 24 janvier 2025 au 9 janvier 2026" tells the reader something; "Aucune
 * transaction" does not.
 *
 * "opération" rather than "transaction" on purpose: this counts every row in
 * the ledger, transfers included, which is not the figure the dashboard's
 * period totals report.
 */
export function historySentence(history: History): string {
  const count = history.transaction_count;
  const noun = count > 1 ? "opérations vont" : "opération va";
  return `Vos ${count} ${noun} du ${frenchDate(history.date_from)} au ${frenchDate(history.date_to)}.`;
}

interface EmptyStateProps {
  /** What is empty, in one sentence. */
  title: string;
  /** Why — the diagnosis. Never a restatement of the title. */
  detail?: string | null;
  /** The way out: a link, a button, or nothing when there is genuinely none. */
  children?: ReactNode;
}

/**
 * An empty state that diagnoses instead of describing. Shared by the dashboard
 * and the transaction list, which have exactly the same three cases to tell
 * apart: nothing imported at all, nothing in this period, nothing matching the
 * filters. Purely presentational — each screen owns its own French copy,
 * because only the screen knows which case it is in.
 */
export function EmptyState({ title, detail, children }: EmptyStateProps) {
  return (
    <div className="yd-empty">
      <p className="yd-empty__title">{title}</p>
      {detail ? <p className="yd-empty__detail">{detail}</p> : null}
      {children ? <div className="yd-empty__actions">{children}</div> : null}
    </div>
  );
}
