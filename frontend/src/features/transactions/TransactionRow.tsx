import type { CSSProperties } from "react";

import { EditIcon, TransferIcon } from "../../design/icons";
import { formatCents } from "../../design/theme";
import type { Category, Transaction } from "../../lib/types";

/**
 * The letter that stands for a merchant, from the raw bank label.
 *
 * Bank labels lead with the instrument, not the merchant: "CB CARREFOUR
 * MARKET", "PRLV SEPA NETFLIX", "VIR INSTANTANE EMIS POUR: X". Taking the
 * first letter of the whole string would give every row on a statement the
 * same three initials. The known prefixes are skipped, and what is left is the
 * first word a person would call the thing.
 *
 * A letter and never a logo: a logo would have to be fetched, and this app's
 * promise is that no request leaves the machine.
 */
const LABEL_PREFIXES = [
  "cb", "prlv", "vir", "sepa", "retrait", "paiement", "carte", "achat",
  "prelevement", "virement", "instantane", "emis", "permanent", "perm", "europeen",
];

export function merchantInitial(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const first = words.find((word) => !LABEL_PREFIXES.includes(word.toLowerCase()));
  return (first ?? words[0] ?? "?").charAt(0).toUpperCase();
}

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

/**
 * What the transfer control DOES, in three words. This is what names the
 * button: twenty rows are twenty controls, and each has to say which row it
 * would act on without reciting a paragraph first.
 */
export function transferAction(transaction: Transaction): string {
  return transaction.is_transfer
    ? "Rendre à vos dépenses"
    : "Marquer comme virement interne";
}

/**
 * Why the row is where it is, in the two registers the two cases deserve.
 *
 * A row Yieldo marked itself and a row the reader marked are not the same
 * claim, and this says which it is -- the rule can be argued with, the
 * reader's own decision cannot. It rides on `title` rather than on the
 * accessible name: a name is an instruction, and this is an explanation.
 */
export function transferHint(transaction: Transaction): string {
  if (!transaction.is_transfer) {
    return "Cette opération compte dans vos dépenses. La marquer comme virement interne l'en retire.";
  }
  return transaction.transfer_source === "manual"
    ? "Virement interne : vous l'avez marqué vous-même."
    : "Virement interne : déduit de sa catégorie ou de son compte.";
}

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  onRecategorize: (transactionId: number, categoryId: number | null) => void;
  /** Opens the row in the same drawer that writes a new one. */
  onEdit: (transaction: Transaction) => void;
  /**
   * Flip the row between "argent dépensé" and "argent déplacé", without
   * opening anything. The whole point of the control: the rule gets most rows
   * right and the reader has to be able to fix the rest in one click, on the
   * screen where they noticed.
   */
  onToggleTransfer: (transactionId: number, isTransfer: boolean) => void;
}

export function TransactionRow({
  transaction,
  categories,
  onRecategorize,
  onEdit,
  onToggleTransfer,
}: TransactionRowProps) {
  const category = categories.find((candidate) => candidate.id === transaction.category_id);
  const isCredit = transaction.amount_cents > 0;
  const parents = categories.filter((candidate) => candidate.parent_id === null);
  const sourceHint = SOURCE_HINTS[transaction.category_source] ?? transaction.category_source;
  const sourceBadge = SOURCE_BADGES[transaction.category_source] ?? transaction.category_source;

  return (
    // role="row"/"cell" rather than the tags alone: under 600px the row is laid
    // out as a two-line grid (see TransactionsPage.css), and a browser reads
    // table semantics off the display value unless they are declared.
    <tr
      className={`yd-transactions__row${
        transaction.is_transfer ? " yd-transactions__row--transfer" : ""
      }`}
      role="row"
    >
      <td role="cell" className="yd-num yd-transactions__cell yd-transactions__cell--date">
        {new Date(transaction.date).toLocaleDateString("fr-FR")}
      </td>
      <td role="cell" className="yd-transactions__cell yd-transactions__cell--label">
        <span className="yd-transactions__merchant">
          {/* The merchant's initial, on a quiet disc. It is a landmark, not
              information: the label beside it is what the row actually says,
              and the disc only makes twenty rows scannable by shape. */}
          <span className="yd-transactions__avatar" aria-hidden="true">
            {merchantInitial(transaction.label_raw)}
          </span>
          {/* label_raw, never label_clean: the user must recognize the line
              exactly as it reads on their own bank statement. */}
          <span className="yd-transactions__label">{transaction.label_raw}</span>
        </span>
      </td>
      <td role="cell" className="yd-transactions__cell yd-transactions__cell--category">
        <label className="sr-only" htmlFor={`category-${transaction.id}`}>
          Catégorie
        </label>
        <div className="yd-transactions__category">
          <select
            // The pill's colour is the category's own, so it travels as a
            // custom property rather than as a class: the palette comes from
            // the user's data and no stylesheet could know it. The colour dot
            // that used to sit beside this control is gone — the pill IS the
            // colour now, and the two together were the same fact twice.
            style={
              {
                "--yd-pill": category?.color ?? "var(--yd-text-muted)",
              } as CSSProperties
            }
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
      <td role="cell" className="yd-transactions__cell yd-transactions__cell--amount">
        {/* Both tones are carried by the class, in TransactionsPage.css. They
            used to come from an inline style, which no theme and no stylesheet
            could reach -- and `.yd-amount--negative` matched no rule at all. */}
        <span className={`yd-num ${isCredit ? "yd-amount--positive" : "yd-amount--negative"}`}>
          {formatCents(transaction.amount_cents)}
        </span>
      </td>
      <td role="cell" className="yd-transactions__cell yd-transactions__cell--action">
        {/* aria-pressed, not a checkbox: this is a state the button toggles on
            the row, and the row is the thing being described. The label names
            the operation so twenty of these are twenty different controls. */}
        <button
          type="button"
          className="yd-transactions__transfer"
          aria-pressed={transaction.is_transfer}
          aria-label={`${transferAction(transaction)} : ${transaction.label_raw}`}
          title={transferHint(transaction)}
          onClick={() => onToggleTransfer(transaction.id, !transaction.is_transfer)}
        >
          <TransferIcon aria-hidden="true" />
        </button>
        {/* The label rides along in the accessible name -- as an aria-label,
            never as a second copy of the text in the document -- so twenty
            buttons on screen are twenty different buttons to a screen reader,
            and so the visible word can be dropped at phone width without
            leaving an icon as the only thing naming the control. */}
        <button
          type="button"
          className="yd-transactions__edit"
          aria-label={`Modifier ${transaction.label_raw}`}
          onClick={() => onEdit(transaction)}
        >
          <EditIcon aria-hidden="true" />
          <span className="yd-transactions__edit-text">Modifier</span>
        </button>
      </td>
    </tr>
  );
}
