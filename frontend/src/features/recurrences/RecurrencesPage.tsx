import { motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { CountUp } from "../../design/CountUp";
import { EmptyState, frenchDate } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Recurrence, RecurrenceReport } from "../../lib/types";
import {
  ANNUALISATION_FLOOR_DAYS,
  describeSpread,
  exclusionReason,
  RecurrenceRow,
} from "./RecurrenceRow";
import "./RecurrencesPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * The two lists have to be told apart by name, not by position: they carry the
 * same kind of row and the difference between them — counted or not counted —
 * is the entire subject of this screen. Exported so the tests assert on the
 * same string the reader hears.
 */
export const COUNTED_LIST_LABEL = "Récurrences comptées dans le coût annuel";
export const EXCLUDED_LIST_LABEL = "Récurrences détectées mais non comptées";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * At lg (12 columns): the annual cost beside what needs watching, then the two
 * lists full width underneath. The cost cell is the wider of the pair, 7 to 5,
 * because it carries the figure *and* everything qualifying it — the engine's
 * notice, the counted/excluded split, the scope. Measured at 1440 with the
 * spans the other way round: the cost cell's prose wrapped into eleven lines
 * and left the four-line alerts cell beside it half empty.
 */
const SPAN = {
  cost: { base: 1, md: 6, lg: 7 },
  alerts: { base: 1, md: 6, lg: 5 },
  list: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

interface Split {
  counted: Recurrence[];
  excluded: Recurrence[];
  unstable: number;
  rises: number;
  falls: number;
}

/**
 * The list, cut along the one line that matters, and re-sorted where the
 * backend's order would mislead.
 *
 * Recurrences arrive sorted on `abs(annual_cents)` with the annualisation gate
 * ignored, so on a short ledger the biggest figure in the payload is exactly
 * the one that takes no part in the total. Rendering the list as sent puts it
 * first under a heading that says "coût des abonnements". Counted rows keep
 * that order — there it means what it says, most expensive first, which is why
 * the reader opened the screen. Excluded rows are re-sorted on the amount
 * actually charged, because for a non-annualisable row `annual_cents` is a
 * figure this screen refuses to show and ordering by an invisible key reads as
 * no order at all.
 */
function splitRecurrences(recurrences: Recurrence[]): Split {
  const counted: Recurrence[] = [];
  const excluded: Recurrence[] = [];
  for (const item of recurrences) {
    (exclusionReason(item) === null ? counted : excluded).push(item);
  }
  excluded.sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents));

  const changes = recurrences.map((item) => item.price_change).filter((c) => c !== null);
  return {
    counted,
    excluded,
    unstable: recurrences.filter(
      (item) => describeSpread(item.amount_cents, item.amount_spread_cents).unstable,
    ).length,
    rises: changes.filter((c) => c.ratio > 0).length,
    falls: changes.filter((c) => c.ratio < 0).length,
  };
}

export function RecurrencesPage() {
  const reduced = useReducedMotion();
  const [report, setReport] = useState<RecurrenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // No period filter, deliberately — see the route's docstring. A
        // monthly subscription cannot be recognised from one month of
        // statements, so this screen always asks about the whole ledger.
        const body = await api.get<RecurrenceReport>("/recurrences");
        if (cancelled) return;
        setReport(body);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setReport(null);
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const split = useMemo(
    () => splitRecurrences(report?.recurrences ?? []),
    [report?.recurrences],
  );

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement des récurrences">
        <BentoCell span={SPAN.cost} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--rec-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--rec-figure" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.alerts} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--rec-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--rec-alerts" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.list} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--rec-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--rec-list" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (report === null) {
    body = null;
  } else if (report.recurrences.length === 0) {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.list} {...entryProps(reduced)}>
          <EmptyState
            title="Aucune récurrence détectée."
            // The backend's own sentence, not a paraphrase: it knows precisely
            // what was missing, and an empty list with no reason reads as "you
            // have no subscriptions", which is a different claim.
            detail={report.notice}
          >
            <p className="yd-recurrences__audit">
              {`${report.analysed_groups} ${plural(report.analysed_groups, "libellé examiné", "libellés examinés")} : `}
              {`${report.rejected_thin} ${plural(report.rejected_thin, "trop peu fréquent", "trop peu fréquents")}, `}
              {`${report.rejected_irregular} ${plural(report.rejected_irregular, "trop irrégulier", "trop irréguliers")}.`}
            </p>
            <Link to="/import" className="yd-empty__action">
              Importer d'autres relevés
            </Link>
          </EmptyState>
        </BentoCell>
      </BentoGrid>
    );
  } else {
    const computable = report.recurrences.some((item) => item.annualisable);

    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.cost} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Coût des abonnements</h2>

          {/* A total of zero is a claim, and here it would be the wrong one:
              nothing was watched long enough to cost a year, which is not the
              same as costing nothing. The engine's own notice says why, just
              below. */}
          {computable ? (
            <>
              <CountUp
                value={Math.abs(report.annual_subscription_cents)}
                format={(cents) => formatCents(cents)}
                className="yd-recurrences__annual"
              />
              <p className="yd-recurrences__annual-note">
                {`par an, soit ${formatCents(Math.abs(report.monthly_subscription_cents))} par mois`}
              </p>
            </>
          ) : (
            <p className="yd-recurrences__uncomputable">Pas encore calculable</p>
          )}

          {report.notice !== null ? (
            <p className="yd-recurrences__notice">{report.notice}</p>
          ) : null}

          <p className="yd-recurrences__scope">
            {`${split.counted.length} ${plural(split.counted.length, "récurrence comptée", "récurrences comptées")} dans ce total. `}
            {split.excluded.length > 0
              ? `${split.excluded.length} ${plural(split.excluded.length, "récurrence détectée n'y est pas comptée", "récurrences détectées n'y sont pas comptées")}.`
              : ""}
          </p>
          <p className="yd-recurrences__scope">
            Prélèvements récurrents uniquement. Les revenus réguliers sont listés plus bas
            mais n'entrent dans aucun coût.
          </p>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.alerts} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">À surveiller</h2>
          <ul className="yd-recurrences__alerts">
            <li>
              {report.missing_count === 0
                ? "Aucun prélèvement attendu ne manque à l'appel."
                : `${report.missing_count} ${plural(report.missing_count, "prélèvement attendu et jamais arrivé", "prélèvements attendus et jamais arrivés")}.`}
            </li>
            <li>
              {/* Split by sign rather than reported as one count: a fall is
                  as real a result as a rise, and calling both "hausses" would
                  be a small lie repeated on every screen that shows them. */}
              {split.rises === 0 && split.falls === 0
                ? "Aucun changement de prix détecté."
                : [
                    split.rises > 0
                      ? `${split.rises} ${plural(split.rises, "hausse de prix", "hausses de prix")}`
                      : "",
                    split.falls > 0
                      ? `${split.falls} ${plural(split.falls, "baisse de prix", "baisses de prix")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(", ") + " depuis le début de l'historique."}
            </li>
            <li>
              {/* The clockwork non-subscription. `normalize_label` strips the
                  card suffix, so every withdrawal lands in one weekly-looking
                  group; the spread of its amounts is the only thing that
                  gives it away. */}
              {split.unstable === 0
                ? "Tous les montants repérés sont stables d'une échéance à l'autre."
                : `${split.unstable} ${plural(split.unstable, "libellé au montant variable", "libellés au montant variable")} : un même libellé peut regrouper des opérations différentes.`}
            </li>
            {report.ledger_last_on !== null ? (
              <li className="yd-recurrences__clock">
                {`Statuts jugés au ${frenchDate(report.ledger_last_on)}, dernière date de votre historique, et non à la date du jour.`}
              </li>
            ) : null}
          </ul>
        </BentoCell>

        {split.counted.length > 0 ? (
          <BentoCell
            as={motion.div}
            span={SPAN.list}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <h2 className="yd-panel__title">Comptés dans le coût annuel</h2>
            <p className="yd-recurrences__caption">
              Du plus cher au moins cher, sur douze mois.
            </p>
            <ul className="yd-recurrences__list" aria-label={COUNTED_LIST_LABEL}>
              {split.counted.map((item) => (
                <RecurrenceRow
                  key={item.label_key}
                  recurrence={item}
                  ledgerLastOn={report.ledger_last_on}
                />
              ))}
            </ul>
          </BentoCell>
        ) : null}

        {split.excluded.length > 0 ? (
          <BentoCell
            as={motion.div}
            span={SPAN.list}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <h2 className="yd-panel__title">Détectés, mais hors du total</h2>
            {/* Three exclusions land in this one list and they are not the same
                claim, so the section names all three and each row says which
                one applies to it. */}
            <p className="yd-recurrences__caption">
              Trois raisons de ne pas compter une récurrence : c'est un revenu, plus aucun
              prélèvement n'apparaît dans l'historique, ou elle n'a pas encore été observée
              assez longtemps. Chaque ligne dit laquelle.
            </p>
            {/* The accepted cost of the annualisation rule, said out loud. A
                reader who finds a subscription he pays every month sitting
                outside the total, with no explanation, is looking at what
                reads as a bug. */}
            <p className="yd-recurrences__caption">
              {`Un prélèvement n'entre dans le total qu'une fois ${ANNUALISATION_FLOOR_DAYS} jours d'historique écoulés entre sa première et sa dernière échéance. Un abonnement souscrit ce trimestre est donc bien détecté et affiché ici, mais il n'entre dans le total qu'à partir de sa quatrième ou cinquième échéance mensuelle.`}
            </p>
            {/* Not "par coût annuel" — that is precisely the key this list may
                not be ordered on, since the rows that fail the 91-day bar have
                no annual cost to be ordered by. */}
            <p className="yd-recurrences__caption">
              Classés par montant prélevé, et non par coût annuel : celui-ci n'est pas calculé
              pour les lignes observées moins de {ANNUALISATION_FLOOR_DAYS} jours.
            </p>
            <ul className="yd-recurrences__list" aria-label={EXCLUDED_LIST_LABEL}>
              {split.excluded.map((item) => (
                <RecurrenceRow
                  key={item.label_key}
                  recurrence={item}
                  ledgerLastOn={report.ledger_last_on}
                />
              ))}
            </ul>
          </BentoCell>
        ) : null}
      </BentoGrid>
    );
  }

  return (
    <section className="yd-recurrences">
      <div className="yd-recurrences__header">
        <h1>Récurrences</h1>
        <p className="yd-recurrences__lead">
          Abonnements et prélèvements repérés dans tout votre historique.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-recurrences__alert">
          {error}
        </p>
      ) : null}

      {body}
    </section>
  );
}
