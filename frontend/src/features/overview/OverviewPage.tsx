import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { CashflowChart } from "../../charts/CashflowChart";
import { buildCategoryTreemapItems, CategoryTreemap } from "../../charts/CategoryTreemap";
import { SpendingCalendar } from "../../charts/SpendingCalendar";
import { WaterfallChart } from "../../charts/WaterfallChart";
import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { CountUp } from "../../design/CountUp";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { useTheme } from "../../app/ThemeProvider";
import { ApiError, api } from "../../lib/api";
import type { CalendarPoint, Category, CategoryBreakdown, Granularity, SeriesBucket, Summary } from "../../lib/types";
import { Sparkline, StatTile } from "./StatTile";
import "./OverviewPage.css";
import { PeriodSelector } from "../transactions/PeriodSelector";
import { usePeriod, type UsePeriodResult } from "../transactions/usePeriod";

// Both screens read/write the same ?periode=&du=&au= query parameters
// through usePeriod(), but each route still carries its own independent URL
// -- landing on /transactions fresh does not inherit whatever period was
// selected on the dashboard. What *is* shared: the parsing/formatting logic
// (one usePeriod, one PeriodSelector) and this link, which carries the
// dashboard's current period across explicitly so following it never resets
// the reader back to the transactions view's own default.
function transactionsHrefFor(period: UsePeriodResult): string {
  const params = new URLSearchParams({ periode: period.preset, du: period.from, au: period.to });
  return `/transactions?${params.toString()}`;
}

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

// The finer the bucket, the more legible a short range is; a year-long range
// drawn in daily buckets would be an unreadable wall of bars. Chosen by the
// actual span requested (not the preset name) so a custom range gets the
// same honest treatment as a preset one.
export function granularityForRange(from: string, to: string): Granularity {
  if (!from || !to) return "month";
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days <= 45) return "day";
  if (days <= 120) return "week";
  if (days <= 730) return "month";
  return "quarter";
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

// French writes the first of the month "1er"; every other day is a bare
// numeral. Intl has no option for it, so the ordinal is applied here.
function frenchDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  const rest = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return `${day === 1 ? "1er" : day} ${rest}`;
}

/**
 * The range the summary actually covers, which is not always the range that
 * was asked for: the "Tout" preset sends no bounds at all and the backend
 * answers with the span of the data itself. The hero states what it is
 * showing, so it has to read the answer, never the request.
 */
export function coveredRangeLabel(summary: Summary): string {
  return `Du ${frenchDate(summary.date_from)} au ${frenchDate(summary.date_to)}`;
}

interface LoadErrors {
  summary?: string;
  series?: string;
  categories?: string;
  calendar?: string;
  reference?: string;
}

/**
 * One source of truth for the shape of the dashboard. The loading skeletons
 * and the loaded content are laid on the *same* cells at the same spans, so
 * nothing on the page moves when the data lands.
 *
 * Hierarchy is area, and at lg (12 columns) the rows tile exactly:
 *
 *   1-2 | hero, full width
 *   3-5 | cash-flow (7 wide, 3 rows) | Entrées / Sorties / Taux d'épargne (5)
 *     6 | treemap (5) | waterfall (7)
 *     7 | calendar, full width
 *
 * The hero is the widest cell *and* the tallest of the full-width ones, which
 * is what actually makes it the biggest rectangle on the screen. That is a
 * pixel claim, not a span claim: the calendar is full width too, so nothing
 * but the hero's height keeps it ahead. Measured areas are in task-3-report.md.
 * Do not give another cell 12 columns unless it is shorter than the hero.
 */
const SPAN = {
  // Full width. The net balance is the only figure on this page that answers
  // "how am I doing", so it gets the whole top band rather than half of it.
  hero: { base: 1, md: 6, lg: 12 },
  // 7 of 12, three rows tall, with the three component figures stacked in the
  // remaining 5 columns beside it.
  cashflow: { base: 1, md: 6, lg: 7 },
  stat: { base: 1, md: 2, lg: 5 },
  treemap: { base: 1, md: 6, lg: 5 },
  waterfall: { base: 1, md: 6, lg: 7 },
  // Full width, and not the 5 columns the plan sketched: this is a 53-week
  // strip drawn at a fixed 16px cell, so anything under ~850px clips the back
  // half of the year off the right edge. Its natural aspect is ~7:1 -- a wide
  // short band is the shape it wants, and the shape it now gets. Short is also
  // what keeps it under the hero despite sharing its width.
  calendar: { base: 1, md: 6, lg: 12 },
  emptyState: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** The top band. Two rows is a floor on the hero's height, not a ceiling. */
const HERO_ROWS = 2;

/** The cash-flow chart stands as tall as the three stat cells beside it. */
const CASHFLOW_ROWS = 3;

type SkeletonVariant =
  | "label"
  | "title"
  | "value"
  | "hero-value"
  | "meta"
  | "caption"
  | "spark"
  | "chart"
  | "chart-tall"
  | "chart-short";

function Skeleton({ variant }: { variant: SkeletonVariant }) {
  return <div className={`yd-skeleton yd-skeleton--${variant}`} aria-hidden="true" />;
}

/**
 * The same grid as the loaded dashboard, cell for cell. Deliberately not
 * animated: skeletons are a placeholder for content that has not arrived, and
 * staggering their entry would animate the wait itself.
 */
function DashboardSkeleton() {
  // role="status" so the wait is announced once rather than being silence for
  // a screen reader; the bars themselves are aria-hidden decoration.
  return (
    <BentoGrid role="status" aria-busy="true" aria-label="Chargement du tableau de bord">
      <BentoCell span={SPAN.hero} rows={HERO_ROWS} className="yd-hero">
        {/* The hero's own blocks, so every bar stands in the box it replaces
            and the two states resolve to the identical height. */}
        <div className="yd-hero__head">
          <div className="yd-hero__figure">
            <Skeleton variant="label" />
            <Skeleton variant="hero-value" />
          </div>
          <div className="yd-hero__meta">
            <Skeleton variant="meta" />
          </div>
        </div>
        <div className="yd-hero__trend">
          <Skeleton variant="caption" />
          <Skeleton variant="spark" />
        </div>
      </BentoCell>

      <BentoCell span={SPAN.cashflow} rows={CASHFLOW_ROWS} className="yd-panel">
        <Skeleton variant="title" />
        <Skeleton variant="chart" />
      </BentoCell>

      {["entrees", "sorties", "epargne"].map((key) => (
        <BentoCell span={SPAN.stat} key={key}>
          {/* The real tile's own class, so the pair of bars is centred and
              spaced exactly as the label and figure that replace them. */}
          <div className="yd-stat-tile">
            <Skeleton variant="label" />
            <Skeleton variant="value" />
          </div>
        </BentoCell>
      ))}

      <BentoCell span={SPAN.treemap} className="yd-panel">
        <Skeleton variant="title" />
        <Skeleton variant="chart-tall" />
      </BentoCell>

      <BentoCell span={SPAN.waterfall} className="yd-panel">
        <Skeleton variant="title" />
        <Skeleton variant="chart-tall" />
      </BentoCell>

      <BentoCell span={SPAN.calendar} className="yd-panel">
        <Skeleton variant="title" />
        <Skeleton variant="chart-short" />
      </BentoCell>
    </BentoGrid>
  );
}

/**
 * The running balance across the period, in integer cents: point i is the sum
 * of every bucket's net up to and including i, so the line ends on the same
 * quantity the hero prints in figures instead of on the last bucket alone.
 * Integer arithmetic throughout -- the only ratio taken on these numbers is
 * Sparkline's normalisation to geometry, which is the display boundary.
 */
export function cumulativeNetCents(buckets: SeriesBucket[]): number[] {
  const running: number[] = [];
  let total = 0;
  for (const bucket of buckets) {
    total += bucket.net_cents;
    running.push(total);
  }
  return running;
}

/**
 * The net balance, at display size, and the only cell on the page that spans
 * the full width of the grid twice over. Red only when the balance is actually
 * negative -- the app reserves it for something being wrong, never for "this
 * is an expense", so a positive net stays in the plain text colour rather
 * than turning the largest element on the page green.
 *
 * The trend band under the figure is what earns the height: a cell this wide
 * that only printed four lines of text would be a dead rectangle, and the
 * period's shape is the one thing a single number cannot say.
 */
function NetHero({
  summary,
  series,
  reduced,
}: {
  summary: Summary;
  series: SeriesBucket[];
  reduced: boolean;
}) {
  const net = summary.net_cents;
  const delta = summary.comparison.delta_cents;
  const toneClass = net < 0 ? " yd-hero__value--negative" : "";
  const trend = cumulativeNetCents(series);

  return (
    <BentoCell
      as={motion.div}
      span={SPAN.hero}
      rows={HERO_ROWS}
      className="yd-hero"
      {...entryProps(reduced)}
    >
      <div className="yd-hero__head">
        <div className="yd-hero__figure">
          <span className="yd-hero__label">Solde net</span>
          <CountUp
            value={net}
            format={(cents) => formatCents(cents, { signed: true })}
            className={`yd-hero__value${toneClass}`}
          />
        </div>
        <div className="yd-hero__meta">
          <span className={`yd-hero__delta yd-hero__delta--${delta >= 0 ? "good" : "bad"}`}>
            {formatCents(delta, { signed: true })}
            <span className="yd-hero__delta-note"> par rapport à la période précédente</span>
          </span>
          <p className="yd-hero__range">{coveredRangeLabel(summary)}</p>
        </div>
      </div>

      <figure className="yd-hero__trend">
        <figcaption className="yd-hero__trend-caption">Solde cumulé sur la période</figcaption>
        {trend.length > 1 ? (
          <div className="yd-hero__plot">
            <Sparkline values={trend} className="yd-hero__spark" />
          </div>
        ) : (
          // Never an empty box standing in for a line that could not be drawn:
          // one bucket has no shape, and a failed series load says so in the
          // banner above.
          <p className="yd-hero__trend-empty">Pas assez de données pour tracer une tendance.</p>
        )}
      </figure>
    </BentoCell>
  );
}

export function OverviewPage() {
  const period = usePeriod();
  const { resolved } = useTheme();
  const reduced = useReducedMotion();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [series, setSeries] = useState<SeriesBucket[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [calendarPoints, setCalendarPoints] = useState<CalendarPoint[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<LoadErrors>({});
  const [isLoading, setIsLoading] = useState(true);

  const granularity = granularityForRange(period.from, period.to);
  const year = period.to ? new Date(`${period.to}T00:00:00Z`).getUTCFullYear() : new Date().getUTCFullYear();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      const [summaryResult, seriesResult, categoriesResult, calendarResult, referenceResult] =
        await Promise.allSettled([
          api.get<Summary>("/analytics/summary", { date_from: period.from, date_to: period.to }),
          api.get<SeriesBucket[]>("/analytics/series", {
            granularity,
            date_from: period.from,
            date_to: period.to,
          }),
          api.get<CategoryBreakdown[]>("/analytics/categories", {
            date_from: period.from,
            date_to: period.to,
          }),
          api.get<CalendarPoint[]>("/analytics/calendar", { year }),
          api.get<Category[]>("/categories"),
        ]);

      if (cancelled) return;

      const nextErrors: LoadErrors = {};

      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
      else {
        setSummary(null);
        nextErrors.summary = messageFor(summaryResult.reason);
      }

      if (seriesResult.status === "fulfilled") setSeries(seriesResult.value);
      else {
        setSeries([]);
        nextErrors.series = messageFor(seriesResult.reason);
      }

      if (categoriesResult.status === "fulfilled") setCategoryBreakdown(categoriesResult.value);
      else {
        setCategoryBreakdown([]);
        nextErrors.categories = messageFor(categoriesResult.reason);
      }

      if (calendarResult.status === "fulfilled") setCalendarPoints(calendarResult.value);
      else {
        setCalendarPoints([]);
        nextErrors.calendar = messageFor(calendarResult.reason);
      }

      if (referenceResult.status === "fulfilled") setCategories(referenceResult.value);
      else {
        setCategories([]);
        nextErrors.reference = messageFor(referenceResult.reason);
      }

      setErrors(nextErrors);
      setIsLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to, granularity, year]);

  const errorMessages = Object.values(errors).filter((message): message is string => Boolean(message));

  const errorBanner = errorMessages.length > 0 && (
    <>
      {errorMessages.map((message) => (
        <p role="alert" className="yd-overview__alert" key={message}>
          {message}
        </p>
      ))}
    </>
  );

  // A period with nothing in it renders one clear, actionable empty state
  // instead of four chart cards that would each independently render their
  // own "no data" message -- the dashboard is empty as a whole, not chart by
  // chart, so it reads that way.
  const isEmptyPeriod = summary !== null && summary.transaction_count === 0 && errorMessages.length === 0;

  let body: ReactNode;
  if (isLoading) {
    body = <DashboardSkeleton />;
  } else if (isEmptyPeriod) {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.emptyState}
          className="yd-overview__empty"
          {...entryProps(reduced)}
        >
          <p>Aucune transaction sur cette période.</p>
          <Link to="/import" className="yd-overview__empty-cta">
            Importer un relevé
          </Link>
        </BentoCell>
      </BentoGrid>
    );
  } else {
    const treemapItems = buildCategoryTreemapItems(categoryBreakdown, categories, resolved);
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        {summary ? <NetHero summary={summary} series={series} reduced={reduced} /> : null}

        <BentoCell
          as={motion.div}
          span={SPAN.cashflow}
          rows={CASHFLOW_ROWS}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Flux de trésorerie</h2>
          <CashflowChart buckets={series} granularity={granularity} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.stat} {...entryProps(reduced)}>
          <StatTile label="Entrées" valueCents={summary?.inflow_cents ?? null} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.stat} {...entryProps(reduced)}>
          <StatTile label="Sorties" valueCents={summary?.outflow_cents ?? null} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.stat} {...entryProps(reduced)}>
          <StatTile
            label="Taux d'épargne"
            valueCents={summary?.savings_rate ?? null}
            format={formatPercent}
          />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.treemap} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Répartition des dépenses</h2>
          <CategoryTreemap items={treemapItems} />
        </BentoCell>

        {summary ? (
          <BentoCell
            as={motion.div}
            span={SPAN.waterfall}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <h2 className="yd-panel__title">Revenus, dépenses et épargne</h2>
            <WaterfallChart summary={summary} categories={categoryBreakdown} />
          </BentoCell>
        ) : null}

        <BentoCell as={motion.div} span={SPAN.calendar} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Calendrier des dépenses</h2>
          <SpendingCalendar points={calendarPoints} year={year} />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-overview">
      <div className="yd-overview__header">
        <h1>Vue d'ensemble</h1>
        <Link to={transactionsHrefFor(period)} className="yd-overview__transactions-link">
          Voir les transactions de cette période
        </Link>
      </div>

      <PeriodSelector period={period} />

      {errorBanner}

      {body}
    </section>
  );
}
