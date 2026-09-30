import { Link } from "react-router";

import { CategoryMonthsChart } from "../../../charts/CategoryMonthsChart";
import { BentoCell, type BentoSpan } from "../../../design/bento/BentoCell";
import { PanelHead } from "../../../design/bento/PanelHead";
import { AnalysisIcon, CalendarIcon, ListIcon, TrendUpIcon } from "../../../design/icons";
import { formatCents } from "../../../design/theme";
import { plural } from "../../../lib/plural";
import type { BudgetDetail, BudgetDetailPart, BudgetStatus } from "../../../lib/types";

const STATUS_NOTE: Record<BudgetStatus, string> = {
  ok: "Dans le budget",
  at_risk: "En passe de dépasser",
  over: "Budget dépassé",
};

function StatusPill({ status }: { status: BudgetStatus }) {
  return <span className={`yd-universe__pill yd-universe__pill--${status}`}>{STATUS_NOTE[status]}</span>;
}

function operations(count: number): string {
  return `${count} ${plural(count, "opération", "opérations")}`;
}

/** « 2 opérations · 59,00 € en moyenne », or « Aucune opération ». */
function operationsLine(count: number, ticketCents: number | null): string {
  if (count === 0 || ticketCents === null) return "Aucune opération";
  return `${operations(count)} · ${formatCents(Math.abs(ticketCents))} en moyenne`;
}

export function ThisMonthPanel({ detail, span }: { detail: BudgetDetail; span: BentoSpan }) {
  const { budget } = detail;
  return (
    <BentoCell as="section" span={span} className="yd-panel" aria-label="Ce mois">
      <PanelHead icon={CalendarIcon}>Ce mois</PanelHead>
      <dl className="yd-universe__figures">
        <div>
          <dt>Dépensé</dt>
          <dd className="yd-num">{formatCents(Math.abs(detail.spent_cents))}</dd>
        </div>
        <div>
          <dt>Opérations</dt>
          <dd className="yd-num">{operationsLine(detail.count, detail.average_ticket_cents)}</dd>
        </div>
        {budget !== null ? (
          <>
            <div>
              <dt>Budget</dt>
              <dd className="yd-num">{formatCents(budget.budget_cents)}</dd>
            </div>
            <div>
              <dt>{budget.remaining_cents >= 0 ? "Reste" : "Dépassé de"}</dt>
              <dd className="yd-num">{formatCents(Math.abs(budget.remaining_cents))}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {budget !== null ? (
        <p className="yd-universe__status">
          <StatusPill status={budget.status} />
        </p>
      ) : (
        <p className="yd-universe__note">
          Pas de budget sur cette catégorie : fixez-en un depuis l'écran{" "}
          <Link to={`/budgets?mois=${detail.month}`}>Budgets</Link>.
        </p>
      )}
      {budget !== null && budget.spent_cents !== detail.spent_cents ? (
        <p className="yd-universe__note">
          {`Le budget compte ${formatCents(Math.abs(budget.spent_cents))} : les postes qui ont leur propre budget sont suivis sur leur ligne.`}
        </p>
      ) : null}
    </BentoCell>
  );
}

function comparison(detail: BudgetDetail): string | null {
  if (detail.average_cents === null) return null;
  const month = detail.series.find((entry) => entry.month === detail.month);
  // A month the statements only half cover would always look cheap.
  if (!month?.complete) return "Mois incomplet : la comparaison attend la fin du mois.";
  const gap = Math.abs(detail.spent_cents) - Math.abs(detail.average_cents);
  if (gap === 0) return "Ce mois-ci : pile au niveau de la moyenne.";
  return `Ce mois-ci : ${formatCents(Math.abs(gap))} ${gap > 0 ? "au-dessus" : "en dessous"} de la moyenne.`;
}

export function AveragePanel({ detail, span }: { detail: BudgetDetail; span: BentoSpan }) {
  const note = comparison(detail);
  return (
    <BentoCell as="section" span={span} className="yd-panel" aria-label="En moyenne">
      <PanelHead icon={TrendUpIcon}>En moyenne</PanelHead>
      {detail.average_cents === null ? (
        <p className="yd-universe__note">
          {`Pas encore de moyenne : il faut trois mois complets de relevés (${detail.months_counted} pour l'instant).`}
        </p>
      ) : (
        <>
          <dl className="yd-universe__figures">
            <div>
              <dt>Par mois</dt>
              <dd className="yd-num">{formatCents(Math.abs(detail.average_cents))}</dd>
            </div>
            <div>
              <dt>Sur</dt>
              <dd className="yd-num">{`${detail.months_counted} mois complets`}</dd>
            </div>
          </dl>
          {note ? <p className="yd-universe__note">{note}</p> : null}
        </>
      )}
      {detail.years.length > 0 ? (
        <ul className="yd-universe__years">
          {detail.years.map((year) => (
            <li key={year.year}>
              <span className="yd-universe__year">{year.year}</span>
              <span className="yd-num">{formatCents(Math.abs(year.spent_cents))}</span>
              <span className="yd-universe__muted">
                {`${year.months_counted} mois · `}
                {year.monthly_average_cents === null
                  ? "pas de moyenne"
                  : `${formatCents(Math.abs(year.monthly_average_cents))} par mois`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </BentoCell>
  );
}

export function MonthsPanel({ detail, span }: { detail: BudgetDetail; span: BentoSpan }) {
  return (
    <BentoCell as="section" span={span} className="yd-panel" aria-label="Mois par mois">
      <PanelHead
        icon={AnalysisIcon}
        subtitle={
          detail.average_cents === null
            ? "Pas encore de moyenne à tracer"
            : `En pointillés : la moyenne, ${formatCents(Math.abs(detail.average_cents))} par mois`
        }
      >
        Mois par mois
      </PanelHead>
      <CategoryMonthsChart series={detail.series} current={detail.month} averageCents={detail.average_cents} />
    </BentoCell>
  );
}

export function PartsPanel({
  label,
  parts,
  month,
  span,
}: {
  label: string;
  parts: BudgetDetailPart[];
  month: string;
  span: BentoSpan;
}) {
  return (
    <BentoCell as="section" span={span} className="yd-panel" aria-label={label}>
      <PanelHead icon={ListIcon}>{label}</PanelHead>
      <ul className="yd-universe__parts">
        {parts.map((part) => (
          <li key={part.category_id} className="yd-universe__part">
            <Link className="yd-universe__part-name" to={`/budgets/${part.category_id}?mois=${month}`}>
              {part.name}
            </Link>
            <span className="yd-universe__part-amount yd-num">{formatCents(Math.abs(part.spent_cents))}</span>
            <span className="yd-universe__part-detail yd-universe__muted yd-num">
              {operationsLine(part.count, part.average_ticket_cents)}
            </span>
            <span className="yd-universe__part-detail yd-universe__muted yd-num">
              {part.average_cents === null
                ? "pas encore de moyenne"
                : `${formatCents(Math.abs(part.average_cents))} par mois en moyenne`}
            </span>
            {part.budget !== null ? <StatusPill status={part.budget.status} /> : null}
          </li>
        ))}
      </ul>
    </BentoCell>
  );
}
