import { useId, type CSSProperties } from "react";

import { EditIcon, TransferIcon } from "../../design/icons";
import { Sheet } from "../../design/Sheet";
import { formatCents } from "../../design/theme";
import type { Category, Transaction } from "../../lib/types";
import {
  CategoryOptions,
  categorySourceHint,
  merchantInitial,
  transferAction,
  transferHint,
} from "./TransactionRow";
import "./TransactionSheet.css";

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

interface TransactionSheetProps {
  /** The operation the reader tapped; null while none is open. */
  transaction: Transaction | null;
  categories: Category[];
  onClose: () => void;
  onRecategorize: (transactionId: number, categoryId: number | null) => void;
  onToggleTransfer: (transactionId: number, isTransfer: boolean) => void;
  onEdit: (transaction: Transaction) => void;
}

/**
 * One operation, opened on a phone.
 *
 * A phone row is one line of label and category beside the amount; the
 * picker, the transfer switch and the edit button it had no room for live
 * here, one tap away, each at a thumb's size. The same three actions as the
 * row on a wide screen, wired to the same handlers — this is a second door to
 * them, not a second implementation.
 */
export function TransactionSheet({
  transaction,
  categories,
  onClose,
  onRecategorize,
  onToggleTransfer,
  onEdit,
}: TransactionSheetProps) {
  const pickerId = useId();
  const category = transaction
    ? categories.find((candidate) => candidate.id === transaction.category_id)
    : undefined;
  return (
    <Sheet
      open={transaction !== null}
      onClose={onClose}
      title={transaction?.label_raw ?? ""}
      subtitle={transaction ? DAY.format(new Date(`${transaction.date}T12:00:00`)) : undefined}
      leading={
        transaction ? (
          <span className="yd-transactions__avatar" aria-hidden="true">
            {merchantInitial(transaction.label_raw)}
          </span>
        ) : null
      }
    >
      {transaction ? (
        <>
          <p
            className={`yd-num yd-tx-sheet__amount ${
              transaction.amount_cents > 0 ? "yd-amount--positive" : "yd-amount--negative"
            }`}
          >
            {formatCents(transaction.amount_cents)}
          </p>

          <div className="yd-tx-sheet__field">
            <label className="yd-tx-sheet__label" htmlFor={pickerId}>
              Catégorie
            </label>
            <select
              id={pickerId}
              className="yd-tx-sheet__select"
              style={{ "--yd-pill": category?.color ?? "var(--yd-text-muted)" } as CSSProperties}
              value={transaction.category_id ?? ""}
              onChange={(event) => {
                // "" is « Non catégorisé »: null, never a coerced zero the API
                // would read as a category id (see TransactionRow).
                const raw = event.target.value;
                onRecategorize(transaction.id, raw === "" ? null : Number(raw));
              }}
            >
              <CategoryOptions categories={categories} />
            </select>
            <span className="yd-tx-sheet__hint">{categorySourceHint(transaction)}</span>
          </div>

          <div className="yd-tx-sheet__field">
            <button
              type="button"
              className="yd-tx-sheet__action"
              aria-pressed={transaction.is_transfer}
              onClick={() => onToggleTransfer(transaction.id, !transaction.is_transfer)}
            >
              <TransferIcon />
              {transferAction(transaction)}
            </button>
            <span className="yd-tx-sheet__hint">{transferHint(transaction)}</span>
          </div>

          <button
            type="button"
            className="yd-tx-sheet__action"
            onClick={() => onEdit(transaction)}
          >
            <EditIcon />
            Modifier l'opération
          </button>
        </>
      ) : null}
    </Sheet>
  );
}
