import { motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { api } from "../../lib/api";
import { messageFor } from "../../lib/refusal";
import type { Projection } from "../../lib/types";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { FirePanel } from "./FirePanel";
import { MonteCarloPanel } from "./MonteCarloPanel";
import "./ProjectionPage.css";
import { StressPanel } from "./StressPanel";
import { TaxPanel } from "./TaxPanel";
import {
  freshSeed,
  paramsFromQuery,
  queryFromAssumptions,
  queryFromParams,
  requestParams,
  type ProjectionQuery,
} from "./query";

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * The Monte Carlo cell spans the full width at every breakpoint: a fan chart
 * two hundred and forty points wide has nowhere to go in half a row. The
 * assumptions and the starting point share the row above it — the hypotheses
 * are what the whole page is conditional on, so they are read first.
 */
const SPAN = {
  full: { base: 1, md: 6, lg: 12 },
  assumptions: { base: 1, md: 6, lg: 7 },
  start: { base: 1, md: 6, lg: 5 },
  half: { base: 1, md: 6, lg: 6 },
} satisfies Record<string, BentoSpan>;

/**
 * `/projection` — Monte Carlo, FIRE, French tax and the three historical stress
 * tests, over the household's own portfolio and own measured savings capacity.
 *
 * **The refused screen is the primary screen.** The operator holds zero
 * positions and his measured capacity is −746,19 €/month, so all four panels
 * answer with a refusal. Each prints the API's own sentence, verbatim, in the
 * panel's own voice — never an alert, never a blank, never a zero standing in
 * for a figure nobody computed. Naming the wrong cause is this project's most
 * repeated defect, which is why nothing here rewords what the backend said.
 *
 * **The seed is in the URL.** `/api/projection` requires one and refuses to
 * generate one; this screen picks the first one visibly, writes it into
 * `?graine=`, and prints it at the top of the assumptions panel. A copied link
 * redraws the identical band.
 */
export function ProjectionPage() {
  const reduced = useReducedMotion();
  const [params, setParams] = useSearchParams();

  // The seed the URL carries, or a fresh one written into it on first paint.
  // Chosen ONCE per arrival rather than per render: re-rolling it on every
  // render would make the "same seed, same band" promise false on this very
  // screen.
  const [fallbackSeed] = useState(freshSeed);
  const urlSeed = Number(params.get("graine"));
  const seed = Number.isInteger(urlSeed) && params.get("graine") !== null ? urlSeed : fallbackSeed;

  const query = useMemo(() => queryFromParams(params, seed), [params, seed]);

  const [data, setData] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // The URL is the request. A seed that was not in it is written back on the
  // first paint so the address bar and the screen agree before anything is
  // read off either.
  useEffect(() => {
    if (params.get("graine") === null) {
      setParams(paramsFromQuery(query), { replace: true });
    }
  }, [params, query, setParams]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      try {
        const projection = await api.get<Projection>("/projection", requestParams(query));
        if (cancelled) return;
        setData(projection);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setData(null);
        // A 422 here is a malformed REQUEST, not an engine refusing to answer:
        // every engine refusal on this route arrives on a 200 as content. So
        // there is no `refusalReason` branch — both cases are genuinely a
        // failed load, and both belong in the alert.
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [query]);

  function apply(next: ProjectionQuery) {
    setParams(paramsFromQuery(next));
  }

  let body: ReactNode;

  if (isLoading && data === null) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de la projection">
        <BentoCell span={SPAN.assumptions} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.start} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.full} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--patrimoine-table" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (data === null) {
    body = null;
  } else {
    const { portfolio, assumptions } = data;

    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.assumptions}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Hypothèses de ce calcul</h2>
          <AssumptionsPanel
            assumptions={assumptions}
            // Edited against what actually RAN, not against what the URL says:
            // the two agree in every normal case, and where they cannot (a
            // pasted link with a malformed parameter), the panel must show the
            // run the figures came from.
            query={queryFromAssumptions(assumptions)}
            onApply={apply}
            onNewSeed={() => apply({ ...queryFromAssumptions(assumptions), seed: freshSeed() })}
            monthlyContributionCents={data.capacity === null ? null : data.capacity.median_cents}
          />
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.start}
          className="yd-panel yd-projection__cell--fit"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Point de départ mesuré</h2>
          <dl className="yd-projection__start">
            <div className="yd-fact">
              <dt className="yd-fact__label">Capital valorisé</dt>
              <dd className="yd-fact__value">{formatCents(portfolio.market_value_cents)}</dd>
              <dd className="yd-fact__note">
                {/* "0 position valorisée sur 0" is grammatical and says
                    nothing. An empty portfolio is a different fact from a
                    partially-valued one, and gets its own sentence. */}
                {portfolio.positions_total === 0
                  ? "Aucune position déclarée : Yieldo ne valorise que ce que vous lui déclarez."
                  : `${portfolio.positions_valued} position${portfolio.positions_valued > 1 ? "s" : ""} valorisée${
                      portfolio.positions_valued > 1 ? "s" : ""
                    } sur ${portfolio.positions_total}.`}
                {portfolio.positions_missing_price + portfolio.positions_missing_fx > 0
                  ? " C'est un plancher, pas la valeur de votre patrimoine."
                  : ""}{" "}
                <Link className="yd-projection__link" to="/patrimoine">
                  {portfolio.positions_total === 0
                    ? "Déclarer mes positions"
                    : "Voir le détail par position"}
                </Link>
              </dd>
            </div>
            <div className="yd-fact">
              <dt className="yd-fact__label">Capacité d'épargne mesurée</dt>
              <dd
                className={`yd-fact__value${
                  data.capacity === null
                    ? " yd-fact__value--words"
                    : data.capacity.median_cents < 0
                      ? " yd-projection__figure--negative"
                      : " yd-projection__figure--positive"
                }`}
              >
                {data.capacity === null
                  ? "Non mesurable"
                  : `${formatCents(data.capacity.median_cents, { signed: true })} par mois`}
              </dd>
              <dd className="yd-fact__note">
                {data.capacity === null
                  ? (data.capacity_unavailable_reason ?? "")
                  : `Médiane de ${data.months_observed} mois complets de relevés. C'est ce que la simulation verse — ou retire — chaque mois.`}
              </dd>
            </div>
            <div className="yd-fact">
              <dt className="yd-fact__label">Dépense mensuelle mesurée</dt>
              <dd
                className={`yd-fact__value${data.expense_rate === null ? " yd-fact__value--words" : ""}`}
              >
                {data.expense_rate === null
                  ? "Non mesurable"
                  : `${formatCents(data.expense_rate.median_cents)} par mois`}
              </dd>
              <dd className="yd-fact__note">
                C'est elle qui fixe le capital visé pour l'indépendance financière.
              </dd>
            </div>
          </dl>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Trajectoires simulées du capital</h2>
          {data.monte_carlo === null ? (
            <p className="yd-projection__refusal" data-testid="yd-mc-refusal">
              {data.monte_carlo_unavailable_reason}
            </p>
          ) : (
            <MonteCarloPanel projection={data.monte_carlo} />
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.half}
          // `--fit` so the two cells beside each other keep their OWN heights.
          // Stretched to the row, the shorter of the two ends in a tall empty
          // box — the exact defect /patrimoine's empty state was corrected for.
          className="yd-panel yd-projection__cell--fit"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Indépendance financière</h2>
          {data.fire === null ? (
            <p className="yd-projection__refusal" data-testid="yd-fire-refusal">
              {data.fire_unavailable_reason}
            </p>
          ) : (
            <FirePanel fire={data.fire} />
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.half}
          className="yd-panel yd-projection__cell--fit"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Fiscalité d'une cession aujourd'hui</h2>
          {data.tax === null ? (
            <p className="yd-projection__refusal" data-testid="yd-tax-refusal">
              {data.tax_unavailable_reason}
            </p>
          ) : (
            <TaxPanel tax={data.tax} />
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Tests de résistance</h2>
          <StressPanel stress={data.stress} refusal={data.stress_unavailable_reason} />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-projection">
      <div className="yd-projection__header">
        <h1>Projection</h1>
        <p className="yd-projection__lead">
          Ce que vos positions et vos relevés permettent de calculer sur le long terme&nbsp;: des
          trajectoires simulées plutôt qu'un chiffre unique, un délai vers l'indépendance
          financière, l'impôt qu'une cession déclencherait aujourd'hui, et trois krachs réels
          appliqués à ce que vous détenez. Chaque hypothèse est affichée à côté du chiffre
          qu'elle a produit — <strong>Yieldo calcule, il ne prédit pas</strong>.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-projection__alert">
          {`Projection indisponible : ${error}`}
        </p>
      ) : null}

      {body}
    </section>
  );
}
