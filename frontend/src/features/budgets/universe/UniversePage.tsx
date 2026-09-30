import type { ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { BentoCell, type BentoSpan } from "../../../design/bento/BentoCell";
import { BentoGrid } from "../../../design/bento/BentoGrid";
import { EmptyState } from "../../../design/EmptyState";
import { BudgetsIcon } from "../../../design/icons";
import { PageHead } from "../../../design/PageHead";
import "../../../design/Skeleton.css";
import { formatCents } from "../../../design/theme";
import { ApiError } from "../../../lib/api";
import type { BudgetDetail } from "../../../lib/types";
import { useApiQuery } from "../../../lib/useApiQuery";
import { MonthNav, monthLabel } from "../MonthNav";
import { AveragePanel, MonthsPanel, PartsPanel, ThisMonthPanel } from "./panels";
import { gaugeFor, partReadings } from "./readings";
import { universeFor } from "./registry";
import { CarScene } from "./scenes/car/CarScene";
import "./UniversePage.css";

const SPAN = {
  month: { base: 1, md: 3, lg: 6 },
  average: { base: 1, md: 3, lg: 6 },
  wide: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * The two figures the page is for, in one sentence under the title: what the
 * category cost in the month on screen, and what it costs in an ordinary
 * month — or that there is no ordinary month yet, said rather than faked.
 */
export function leadSentence(detail: BudgetDetail): string {
  const month = `${formatCents(Math.abs(detail.spent_cents))} en ${monthLabel(detail.month)}`;
  if (detail.average_cents === null) {
    return `${month} · pas encore de moyenne (moins de trois mois complets de relevés)`;
  }
  const since = detail.series.find((entry) => entry.complete)?.month;
  const average = `${formatCents(Math.abs(detail.average_cents))} par mois en moyenne`;
  return since ? `${month} · ${average} depuis ${monthLabel(since)}` : `${month} · ${average}`;
}

/**
 * One category's universe: what it cost this month, what it costs in an
 * ordinary month over the years, and — when the category has one — the scene
 * that draws it (the car for Transport). `?mois=` is shared with Budgets, so
 * going back lands on the month the reader left.
 */
export function UniversePage() {
  const { categoryId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const id = Number(categoryId);
  const valid = Number.isInteger(id) && id > 0;
  const askedMonth = params.get("mois");

  const query = useApiQuery<BudgetDetail>(
    `/budgets/${valid ? id : 0}/detail`,
    { month: askedMonth ?? undefined },
    { enabled: valid },
  );
  const detail = query.data ?? null;
  const current = askedMonth ?? detail?.month ?? "";
  const monthQuery = current ? `?mois=${current}` : "";

  const error = !valid
    ? "Catégorie introuvable"
    : query.error === null
      ? null
      : query.error instanceof ApiError
        ? query.error.detail
        : GENERIC_ERROR;

  const match =
    detail === null
      ? null
      : universeFor({ slug: detail.category.slug, name: detail.category.name, parent: detail.category.parent });

  let body: ReactNode = null;
  if (valid && query.isPending) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de la catégorie">
        <BentoCell span={SPAN.wide}>
          <div className="yd-skeleton yd-skeleton--universe-scene" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.month} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--universe-panel" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.average} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--universe-panel" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (detail !== null && detail.history === null) {
    body = (
      <EmptyState
        title="Aucun relevé importé pour l'instant."
        detail="Importez un relevé bancaire : ce que cette catégorie coûte, mois par mois, apparaîtra ici."
      >
        <Link to="/import" className="yd-empty__action">
          Importer un relevé
        </Link>
      </EmptyState>
    );
  } else if (detail !== null) {
    const parent = detail.category.parent;
    const siblings = detail.siblings.filter((part) => part.category_id !== detail.category.id);
    body = (
      <>
        {match?.universe === "car" ? (
          <CarScene
            gauge={gaugeFor(detail.budget)}
            gaugeTitle={`Budget ${detail.category.name}`}
            parts={partReadings(detail, match)}
            onSelect={(next) => navigate(`/budgets/${next}${monthQuery}`)}
          />
        ) : null}
        <BentoGrid>
          <ThisMonthPanel detail={detail} span={SPAN.month} />
          <AveragePanel detail={detail} span={SPAN.average} />
          <MonthsPanel detail={detail} span={SPAN.wide} />
          {detail.parts.length > 0 ? (
            <PartsPanel label="Postes" parts={detail.parts} month={detail.month} span={SPAN.wide} />
          ) : null}
          {parent !== null && siblings.length > 0 ? (
            <PartsPanel
              label={`Les autres postes de ${parent.name}`}
              parts={siblings}
              month={detail.month}
              span={SPAN.wide}
            />
          ) : null}
        </BentoGrid>
      </>
    );
  }

  return (
    <section className="yd-universe">
      <PageHead
        icon={BudgetsIcon}
        title={detail?.category.name ?? "Catégorie"}
        className="yd-universe__head"
        actions={
          <div className="yd-universe__actions">
            <Link to={`/budgets${monthQuery}`} className="yd-universe__back">
              Budgets
            </Link>
            <MonthNav current={current} onChange={(key) => setParams({ mois: key })} />
          </div>
        }
      >
        {detail !== null ? <p className="yd-universe__lead">{leadSentence(detail)}</p> : null}
      </PageHead>

      {error !== null ? (
        <p role="alert" className="yd-universe__alert">
          {error}
        </p>
      ) : null}

      {body}
    </section>
  );
}
