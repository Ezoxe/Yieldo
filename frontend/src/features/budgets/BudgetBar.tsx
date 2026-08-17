import { formatCents } from "../../design/theme";
import type { BudgetLine } from "../../lib/types";

/**
 * The consumed share as a whole percentage, clamped into [0, 100].
 *
 * Capped rather than allowed to overflow: a category at 340 % of its budget
 * would otherwise draw a bar three times the width of its row. The overrun is
 * stated in figures underneath instead, where it can be read exactly.
 *
 * The single source of that rule. Both the width the bar is drawn at and the
 * `aria-valuenow` it announces come from here, so the picture and the number
 * cannot disagree about the same line.
 */
export function consumedPercent(ratio: number): number {
  return Math.round(Math.min(100, Math.max(0, ratio * 100)));
}

/** {@link consumedPercent}, as the CSS percentage the fill is sized in. */
export function fillPercent(ratio: number): string {
  return `${consumedPercent(ratio)}%`;
}

const STATUS_NOTE: Record<BudgetLine["status"], string> = {
  ok: "Dans le budget",
  at_risk: "En passe de dépasser",
  over: "Budget dépassé",
};

interface BudgetBarProps {
  line: BudgetLine;
}

export function BudgetBar({ line }: BudgetBarProps) {
  const spent = Math.abs(line.spent_cents);
  const percent = consumedPercent(line.consumed_ratio);

  return (
    <div className={`yd-budget yd-budget--${line.status}`}>
      <div className="yd-budget__head">
        <span className="yd-budget__name">{line.name}</span>
        {line.is_essential ? (
          <span className="yd-budget__essential" title="Dépense essentielle">
            Essentiel
          </span>
        ) : null}
        <span className="yd-budget__figures">
          {formatCents(spent)} <span aria-hidden="true">/</span>{" "}
          <span className="sr-only">sur</span>
          {formatCents(line.budget_cents)}
        </span>
      </div>

      {/* The track lives in a grid row with a definite inline size (see
          BudgetsPage.css). A percentage width inside an auto-width flex column
          resolves against nothing and renders at ZERO -- which is how the
          dashboard once shipped a loading skeleton with no figure in it. */}
      <div
        className="yd-budget__track"
        role="progressbar"
        aria-label={`Consommation du budget ${line.name}`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="yd-budget__fill" style={{ width: fillPercent(line.consumed_ratio) }} />
      </div>

      <p className="yd-budget__note">
        <span className="yd-budget__status">{STATUS_NOTE[line.status]}</span>
        {line.remaining_cents >= 0
          ? ` — Il reste ${formatCents(line.remaining_cents)}`
          : ` — Dépassé de ${formatCents(Math.abs(line.remaining_cents))}`}
        {line.projected_cents !== null
          ? ` — À ce rythme, ${formatCents(Math.abs(line.projected_cents))} sur le mois`
          : ""}
      </p>
    </div>
  );
}
