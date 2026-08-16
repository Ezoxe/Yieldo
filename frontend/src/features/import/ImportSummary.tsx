import { CountUp } from "../../design/CountUp";
import { formatCents } from "../../design/theme";
import type { ImportBatch, ImportSummary as ImportSummaryData } from "../../lib/types";
import "./ImportPage.css";

interface ImportSummaryProps {
  summary: ImportSummaryData | null;
  batch: ImportBatch | null;
  isBusy: boolean;
  onCancelImport: () => void;
}

function formatPeriod(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const format = (value: string) => new Date(value).toLocaleDateString("fr-FR");
  // A non-breaking space before the dash: the range is too wide for one grid
  // track at any width the wizard runs at, so it wraps -- and left to itself it
  // wrapped BEFORE the dash, standing the figure on three lines with a lone "–"
  // in the middle. Glued to the first date, it breaks once, after the dash.
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

export function ImportSummary({ summary, batch, isBusy, onCancelImport }: ImportSummaryProps) {
  // Once the batch exists the import already happened -- the pre-commit banner
  // (still countable, still cancellable-before-the-fact) no longer applies.
  // Plain content: the BentoCell around it is the surface (see ColumnTagger).
  if (batch) {
    return (
      <div className="yd-summary yd-summary--done">
        <h2 className="yd-summary__title">Import terminé</h2>
        <p className="yd-summary__report">
          {plural(batch.rows_imported, "ligne importée")} dans «&nbsp;{batch.filename}&nbsp;»
          {batch.rows_duplicate > 0 ? `, ${plural(batch.rows_duplicate, "doublon ignoré")}` : ""}
          {batch.rows_failed > 0 ? `, ${plural(batch.rows_failed, "ligne en erreur")}` : ""}.
        </p>
        <button type="button" className="yd-summary__cancel" onClick={onCancelImport} disabled={isBusy}>
          Annuler cet import
        </button>
      </div>
    );
  }

  if (!summary) return null;

  const asCount = (value: number) => String(Math.round(value));
  const asMoney = (value: number) => formatCents(value, { signed: true });

  return (
    <div className="yd-summary">
      <dl className="yd-summary__grid">
        <div className="yd-summary__item">
          <dt>Période</dt>
          <dd>{formatPeriod(summary.date_from, summary.date_to)}</dd>
        </div>
        <div className="yd-summary__item">
          <dt>Entrées</dt>
          <dd className="yd-summary__positive">
            <CountUp value={summary.inflow_cents} format={asMoney} />
          </dd>
        </div>
        <div className="yd-summary__item">
          <dt>Sorties</dt>
          <dd className="yd-summary__negative">
            <CountUp value={summary.outflow_cents} format={asMoney} />
          </dd>
        </div>
        <div className="yd-summary__item">
          <dt>Importables</dt>
          <dd>
            <CountUp value={summary.importable} format={asCount} />
          </dd>
        </div>
        <div className="yd-summary__item">
          <dt>Doublons</dt>
          <dd>
            <CountUp value={summary.duplicates} format={asCount} />
          </dd>
        </div>
        <div className="yd-summary__item">
          <dt>Échecs</dt>
          <dd>
            <CountUp value={summary.failed} format={asCount} />
          </dd>
        </div>
      </dl>

      {summary.mapping_errors.length > 0 ? (
        <div role="alert" className="yd-summary__alert">
          <ul>
            {summary.mapping_errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
