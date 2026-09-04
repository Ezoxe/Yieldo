import { AlertsIcon, AnomalyIcon, CheckIcon, type IconComponent } from "../../design/icons";
import { categoryTargetId } from "../../design/ai/targets";
import { InfoTip } from "../../design/InfoTip";
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

/* The mark beside the status. It repeats what the words already say — status
   is never carried by colour or by a glyph alone (WCAG 1.4.1) — and only makes
   the three states separable at a glance down a list of twelve categories. */
const STATUS_ICON: Record<BudgetLine["status"], IconComponent> = {
  ok: CheckIcon,
  at_risk: AnomalyIcon,
  over: AlertsIcon,
};

interface BudgetBarProps {
  line: BudgetLine;
}

export function BudgetBar({ line }: BudgetBarProps) {
  const spent = Math.abs(line.spent_cents);
  const percent = consumedPercent(line.consumed_ratio);
  const StatusIcon = STATUS_ICON[line.status];
  const over = line.remaining_cents < 0;

  return (
    <div className={`yd-budget yd-budget--${line.status}`} data-ai-target={categoryTargetId(line.name)}>
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

      {/* One row, three parts: the state as a badge, the one figure that
          follows from it, and the method behind the fold. This used to be a
          three-line sentence per category — twelve of them down a screen, and
          the figures were the hardest thing on it to find. */}
      <p className="yd-budget__note">
        <span className="yd-budget__status">
          <StatusIcon />
          {over
            ? `Dépassé de ${formatCents(Math.abs(line.remaining_cents))}`
            : STATUS_NOTE[line.status]}
        </span>
        <span className="yd-budget__remaining">
          {over
            ? STATUS_NOTE[line.status]
            : `Il reste ${formatCents(line.remaining_cents)}`}
        </span>
        {line.projected_cents !== null ? (
          <InfoTip label={`Projection du budget ${line.name}`}>
            {`À ce rythme, ${formatCents(Math.abs(line.projected_cents))} sur le mois — la dépense du mois entier si les jours restants ressemblent aux jours écoulés.`}
          </InfoTip>
        ) : null}
      </p>
    </div>
  );
}
