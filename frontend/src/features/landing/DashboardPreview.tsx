import { CountUp } from "../../design/CountUp";
import { formatCents, formatCompactCents } from "../../design/theme";
import "./DashboardPreview.css";

/**
 * A miniature of the real dashboard for the landing hero, built from the same
 * primitives (CountUp, the money formatters, the tokens) with **fabricated**
 * figures.
 *
 * It is never a screenshot and never real data. Everything below is invented,
 * and the figure carries a visible French caption saying so — a visitor must
 * not be able to mistake these numbers for their own account. `aria-hidden`
 * would be the wrong tool: it would hide the caption that makes the disclaimer.
 */

// A plausible French household month, in integer cents like every amount in
// this app. The parts are internally consistent on purpose: the category
// breakdown below sums to exactly OUTFLOW_CENTS, and NET is INFLOW - OUTFLOW,
// so nothing in the preview contradicts anything else in it.
const INFLOW_CENTS = 246_000;
const OUTFLOW_CENTS = 198_740;
const NET_CENTS = INFLOW_CENTS - OUTFLOW_CENTS;
const SAVINGS_RATE = NET_CENTS / INFLOW_CENTS;

interface MonthBucket {
  label: string;
  inflowCents: number;
  outflowCents: number;
}

const MONTHS: MonthBucket[] = [
  { label: "Mars", inflowCents: 243_000, outflowCents: 201_400 },
  { label: "Avril", inflowCents: 246_000, outflowCents: 187_900 },
  { label: "Mai", inflowCents: 251_500, outflowCents: 226_300 },
  { label: "Juin", inflowCents: 246_000, outflowCents: 194_200 },
  { label: "Juillet", inflowCents: 268_000, outflowCents: 205_600 },
  { label: "Août", inflowCents: 246_000, outflowCents: 198_740 },
];

const CATEGORIES: { label: string; cents: number }[] = [
  { label: "Logement", cents: 82_000 },
  { label: "Alimentation", cents: 43_600 },
  { label: "Transports", cents: 21_450 },
  { label: "Loisirs", cents: 18_900 },
  { label: "Santé", cents: 12_300 },
];

function formatRate(rate: number): string {
  return `${(rate * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

interface PreviewStatProps {
  label: string;
  value: number;
  format: (value: number) => string;
  tone?: "positive" | "negative";
}

function PreviewStat({ label, value, format, tone }: PreviewStatProps) {
  const toneClass = tone ? ` yd-preview__stat-value--${tone}` : "";
  return (
    <div className="yd-preview__stat">
      <span className="yd-preview__stat-label">{label}</span>
      <CountUp value={value} format={format} className={`yd-preview__stat-value${toneClass}`} />
    </div>
  );
}

/** Grouped in/out bars — the miniature of the cash-flow chart. */
function CashflowBars() {
  const peak = Math.max(...MONTHS.flatMap((month) => [month.inflowCents, month.outflowCents]));

  return (
    <div className="yd-preview__bars">
      {MONTHS.map((month) => (
        <div className="yd-preview__bar-group" key={month.label}>
          <div className="yd-preview__bar-pair">
            <span
              className="yd-preview__bar yd-preview__bar--in"
              style={{ height: `${(month.inflowCents / peak) * 100}%` }}
            />
            <span
              className="yd-preview__bar yd-preview__bar--out"
              style={{ height: `${(month.outflowCents / peak) * 100}%` }}
            />
          </div>
          <span className="yd-preview__bar-label">{month.label.slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}

/** Proportional rows — the miniature of the category breakdown. */
function CategoryRows() {
  const largest = Math.max(...CATEGORIES.map((category) => category.cents));

  return (
    <ul className="yd-preview__categories">
      {CATEGORIES.map((category) => (
        <li className="yd-preview__category" key={category.label}>
          <span className="yd-preview__category-name">{category.label}</span>
          <span className="yd-preview__category-track">
            <span
              className="yd-preview__category-fill"
              style={{ width: `${(category.cents / largest) * 100}%` }}
            />
          </span>
          <span className="yd-num yd-preview__category-value">
            {formatCompactCents(-category.cents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPreview() {
  return (
    <figure className="yd-preview-figure">
      <div className="yd-preview">
        <div className="yd-preview__chrome">
          <span className="yd-preview__chrome-title">Vue d'ensemble</span>
          <span className="yd-preview__chrome-period">Août 2026</span>
        </div>

        <div className="yd-preview__stats">
          <PreviewStat label="Entrées" value={INFLOW_CENTS} format={(cents) => formatCents(cents)} />
          <PreviewStat
            label="Sorties"
            value={OUTFLOW_CENTS}
            format={(cents) => formatCents(-cents)}
          />
          <PreviewStat
            label="Solde net"
            value={NET_CENTS}
            format={(cents) => formatCents(cents, { signed: true })}
            tone="positive"
          />
          <PreviewStat label="Taux d'épargne" value={SAVINGS_RATE} format={formatRate} />
        </div>

        <div className="yd-preview__panels">
          <section className="yd-preview__panel">
            <h3 className="yd-preview__panel-title">Flux de trésorerie</h3>
            <CashflowBars />
            <p className="yd-preview__legend">
              <span className="yd-preview__legend-item yd-preview__legend-item--in">Entrées</span>
              <span className="yd-preview__legend-item yd-preview__legend-item--out">Sorties</span>
            </p>
          </section>

          <section className="yd-preview__panel">
            <h3 className="yd-preview__panel-title">Répartition des dépenses</h3>
            <CategoryRows />
          </section>
        </div>
      </div>

      <figcaption className="yd-preview-figure__caption">
        Exemple — données fictives. Aperçu du tableau de bord de Yieldo ; aucun de
        ces montants n'est réel.
      </figcaption>
    </figure>
  );
}
