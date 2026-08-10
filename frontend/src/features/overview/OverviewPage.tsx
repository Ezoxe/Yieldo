import { useEffect, useState } from "react";
import { Link } from "react-router";

import { CashflowChart } from "../../charts/CashflowChart";
import { buildCategoryTreemapItems, CategoryTreemap } from "../../charts/CategoryTreemap";
import { SpendingCalendar } from "../../charts/SpendingCalendar";
import { WaterfallChart } from "../../charts/WaterfallChart";
import { GlassCard } from "../../design/glass/GlassCard";
import { useTheme } from "../../app/ThemeProvider";
import { ApiError, api } from "../../lib/api";
import type { CalendarPoint, Category, CategoryBreakdown, Granularity, SeriesBucket, Summary } from "../../lib/types";
import { StatTile } from "./StatTile";
import "./OverviewPage.css";
import { usePeriod } from "../transactions/usePeriod";

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

interface LoadErrors {
  summary?: string;
  series?: string;
  categories?: string;
  calendar?: string;
  reference?: string;
}

function StatTileSkeleton() {
  return <div className="yd-skeleton yd-skeleton--tile" aria-hidden="true" />;
}

function ChartSkeleton() {
  return <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />;
}

export function OverviewPage() {
  const period = usePeriod();
  const { resolved } = useTheme();

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

  if (isLoading) {
    return (
      <section className="yd-overview">
        <h1>Vue d'ensemble</h1>
        <div className="yd-overview__stats">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
        <div className="yd-overview__charts">
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </section>
    );
  }

  // A period with nothing in it renders one clear, actionable empty state
  // instead of four chart cards that would each independently render their
  // own "no data" message -- the dashboard is empty as a whole, not chart by
  // chart, so it reads that way.
  const isEmptyPeriod = summary !== null && summary.transaction_count === 0 && errorMessages.length === 0;

  if (isEmptyPeriod) {
    return (
      <section className="yd-overview">
        <h1>Vue d'ensemble</h1>
        {errorBanner}
        <GlassCard tone="solid" className="yd-overview__empty">
          <p>Aucune transaction sur cette période.</p>
          <Link to="/import" className="yd-overview__empty-cta">
            Importer un relevé
          </Link>
        </GlassCard>
      </section>
    );
  }

  const treemapItems = buildCategoryTreemapItems(categoryBreakdown, categories, resolved);

  return (
    <section className="yd-overview">
      <h1>Vue d'ensemble</h1>
      {errorBanner}

      <div className="yd-overview__stats">
        <StatTile label="Entrées" valueCents={summary?.inflow_cents ?? null} />
        <StatTile label="Sorties" valueCents={summary?.outflow_cents ?? null} />
        <StatTile
          label="Solde net"
          valueCents={summary?.net_cents ?? null}
          deltaCents={summary?.comparison.delta_cents}
        />
        <StatTile
          label="Taux d'épargne"
          valueCents={summary?.savings_rate ?? null}
          format={formatPercent}
        />
      </div>

      <div className="yd-overview__charts">
        <GlassCard tone="solid" className="yd-overview__chart-card">
          <h2>Flux de trésorerie</h2>
          <CashflowChart buckets={series} granularity={granularity} />
        </GlassCard>

        <GlassCard tone="solid" className="yd-overview__chart-card">
          <h2>Répartition des dépenses</h2>
          <CategoryTreemap items={treemapItems} />
        </GlassCard>

        <GlassCard tone="solid" className="yd-overview__chart-card">
          <h2>Calendrier des dépenses</h2>
          <SpendingCalendar points={calendarPoints} year={year} />
        </GlassCard>

        {summary ? (
          <GlassCard tone="solid" className="yd-overview__chart-card">
            <h2>Revenus, dépenses et épargne</h2>
            <WaterfallChart summary={summary} categories={categoryBreakdown} />
          </GlassCard>
        ) : null}
      </div>
    </section>
  );
}

