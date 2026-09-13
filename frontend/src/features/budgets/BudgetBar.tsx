import { useEffect, useRef, useState } from "react";

import { AlertsIcon, AnomalyIcon, CheckIcon, EditIcon, type IconComponent } from "../../design/icons";
import { categoryTargetId } from "../../design/ai/targets";
import { InfoTip } from "../../design/InfoTip";
import { formatCents, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { BudgetHistoryLine, BudgetLine } from "../../lib/types";

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
  /**
   * Called after the ceiling was saved, so the screen re-asks for its
   * report and the bar, the totals and the alerts move together. Absent,
   * the ceiling is a plain figure: the bar is then only a reading.
   */
  onSaved?: () => void;
  /** The last months of this line, for the strip under the bar. */
  history?: BudgetHistoryLine;
}

/**
 * The ceiling, edited where it is read.
 *
 * A budget used to be set from « Sans budget » and never touched again from
 * this screen: changing 450 € to 480 € meant the Catégories screen. The
 * figure is a button; it opens a field in place, Enter or a lost focus saves,
 * Escape gives up. Same parsing and same endpoint as `BudgetInput`, which
 * sets a FIRST ceiling on the unbudgeted list below.
 */
function Ceiling({ line, onSaved }: { line: BudgetLine; onSaved?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const errorId = `yd-budget-ceiling-error-${line.category_id}`;

  useEffect(() => {
    if (!editing) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [editing]);

  if (onSaved === undefined) {
    return <>{formatCents(line.budget_cents)}</>;
  }

  async function save() {
    const cents = parseCents(value);
    if (cents === null || cents <= 0) {
      setError("Montant invalide : saisissez un montant en euros, par exemple 250,50.");
      return;
    }
    if (cents === line.budget_cents) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/categories/${line.category_id}`, { monthly_budget_cents: cents });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="yd-budget__ceiling"
        onClick={() => {
          setValue((line.budget_cents / 100).toFixed(2).replace(".", ","));
          setError(null);
          setEditing(true);
        }}
      >
        <span className="sr-only">{`Modifier le plafond de ${line.name}`}</span>
        <span aria-hidden="true">{formatCents(line.budget_cents)}</span>
        <EditIcon />
      </button>
    );
  }

  return (
    <span className="yd-budget__ceiling-edit">
      <input
        ref={fieldRef}
        type="text"
        inputMode="decimal"
        aria-label={`Plafond mensuel pour ${line.name}`}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className="yd-budget__ceiling-field"
        value={value}
        disabled={saving}
        onChange={(event) => {
          setValue(event.target.value);
          if (error !== null) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setEditing(false);
        }}
        onBlur={() => {
          // A lost focus saves what was typed; a field left as it was found
          // simply closes, and a rejected amount stays open with its message.
          if (!saving && error === null) void save();
        }}
      />
      {error !== null ? (
        <span id={errorId} role="alert" className="yd-budget__ceiling-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The last months of one line, as a strip of bars against the ceiling.
 *
 * Six small bars, each the month's spend as a share of today's ceiling, with
 * the ones above it filled in the negative tone. The accessible name says
 * the count in words, because a strip of bars is a picture and the reader
 * who cannot see it still gets the fact it draws.
 */
function BudgetSpark({ history }: { history: BudgetHistoryLine }) {
  const ceiling = Math.max(history.budget_cents, 1);
  const overCount = history.points.filter((p) => Math.abs(p.spent_cents) > ceiling).length;
  const width = 72;
  const height = 22;
  const gap = 3;
  const bar = (width - gap * (history.points.length - 1)) / Math.max(history.points.length, 1);
  // The tallest bar is either the ceiling or the worst month, so an overrun
  // is drawn as taller than the line and never clipped to it.
  const top = Math.max(ceiling, ...history.points.map((p) => Math.abs(p.spent_cents)));
  const ceilingY = height - (ceiling / top) * height;
  const label =
    `${history.points.length} derniers mois de ${history.name} : ` +
    `${overCount} ${plural(overCount, "mois", "mois")} au-dessus du plafond`;

  return (
    <svg
      className="yd-budget-spark"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      {history.points.map((point, index) => {
        const spent = Math.abs(point.spent_cents);
        const h = Math.max(1, (spent / top) * height);
        const over = spent > ceiling;
        return (
          <rect
            key={point.month}
            className={`yd-budget-spark__bar${over ? " yd-budget-spark__bar--over" : ""}`}
            x={index * (bar + gap)}
            y={height - h}
            width={bar}
            height={h}
            rx={1}
          />
        );
      })}
      <line className="yd-budget-spark__ceiling" x1={0} x2={width} y1={ceilingY} y2={ceilingY} />
    </svg>
  );
}

export function BudgetBar({ line, onSaved, history }: BudgetBarProps) {
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
        {history !== undefined ? <BudgetSpark history={history} /> : null}
        <span className="yd-budget__figures">
          {formatCents(spent)} <span aria-hidden="true">/</span>{" "}
          <span className="sr-only">sur</span>
          <Ceiling line={line} onSaved={onSaved} />
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
