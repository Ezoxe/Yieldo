import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ForecastFanChart } from "../../charts/ForecastFanChart";
import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { CountUp } from "../../design/CountUp";
import { frenchDate } from "../../design/EmptyState";
import { CashflowIcon, ClockIcon, CoinsIcon, ProjectionIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Forecast, Runway } from "../../lib/types";
import { RunwayPanel } from "./RunwayPanel";
import "./CashflowPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * `capacity.MIN_MONTHS_FOR_RATE`. Three complete months is the floor at which a
 * median exists at all — saying so is the difference between a measurement and
 * a claim, which is why the screen flags a rate resting on exactly three.
 *
 * Compared with `===`, never `<=`: below three nothing is measured at all, and
 * "c'est le minimum" said over two months is arithmetically false as well as
 * misleading.
 */
const MIN_MONTHS_FOR_RATE = 3;

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

/**
 * The ledger's last transaction date, when it is genuinely behind the date the
 * runway counts from. Null when the two coincide, where naming it twice says
 * nothing.
 */
function staleLedgerDate(runway: Runway): string | null {
  return runway.ledger_last_on !== null && runway.ledger_last_on !== runway.projected_from
    ? frenchDate(runway.ledger_last_on)
    : null;
}

/**
 * The runway cell's scope note: what the ledger covers, how much of it could be
 * measured, and — when nothing could — that nothing was.
 *
 * `measured` is not derivable from `monthsObserved`. Three complete months are
 * enough to *attempt* a rate and still yield none, because `runway.py` refuses
 * a median that is not a positive burn as well as a sample that is too short.
 * The month count and the outcome are two separate claims, and this sentence
 * used to make the second one on the strength of the first: at two observed
 * months it read "dont 2 mois complets exploitables pour mesurer un rythme"
 * beside two panels saying nothing had been measured.
 */
function runwayScopeSentence(runway: Runway, measured: boolean): string {
  const span = runway.ledger_span_months;
  const observed = runway.months_observed;

  const scope = `Votre historique s'étend sur ${span} ${plural(span, "mois civil", "mois civils")}, dont ${observed} ${
    measured
      ? `${plural(observed, "mois complet exploitable", "mois complets exploitables")} pour mesurer un rythme.`
      : `${plural(observed, "mois complet", "mois complets")}.`
  }`;

  let floor = "";
  if (observed < MIN_MONTHS_FOR_RATE) {
    // A statement about the threshold, not about this ledger's outcome — true
    // whatever the two scenarios did with it.
    floor = ` Il en faut au moins ${MIN_MONTHS_FOR_RATE} pour mesurer un rythme.`;
  } else if (observed === MIN_MONTHS_FOR_RATE) {
    floor = measured
      ? " C'est le minimum en dessous duquel rien n'est mesuré : le rythme reste fragile."
      : " C'est le minimum en dessous duquel rien n'est mesuré.";
  }

  // Position-neutral: each panel carries its own reason, and which one sits
  // where changes with the viewport.
  const outcome = measured ? "" : " Aucun rythme n'a pu en être tiré : chaque scénario dit pourquoi.";

  return `${scope}${floor}${outcome}`;
}

/**
 * Requirement 1, runway side: `depleted_on` counts forward from the real clock,
 * but the burn behind it is only as fresh as the last imported statement.
 *
 * In the conditional when neither scenario computed — there is no autonomy
 * being counted from today, and no rate that was measured up to anything.
 */
function runwayAnchorSentence(runway: Runway, measured: boolean): string {
  const from = frenchDate(runway.projected_from);
  const lastOn = staleLedgerDate(runway);

  if (measured) {
    return lastOn !== null
      ? `Autonomie comptée à partir du ${from}, la date du jour, sur un rythme mesuré jusqu'au ${lastOn}, dernière date de votre historique.`
      : `Autonomie comptée à partir du ${from}, la date du jour.`;
  }
  return lastOn !== null
    ? `Aucune autonomie n'est comptée : elle le serait à partir du ${from}, la date du jour, sur des relevés qui s'arrêtent au ${lastOn}.`
    : `Aucune autonomie n'est comptée : elle le serait à partir du ${from}, la date du jour.`;
}

/**
 * The two-clocks banner, in the mood each half has earned.
 *
 * It used to be built from the two `projected_from` values alone, so on the
 * operator's own data it announced "La prévision part du 9 janvier 2026 …
 * c'est la seule période sur laquelle vos relevés peuvent se prononcer" while
 * the cell underneath printed a refusal and drew nothing. The refusal branch
 * of the forecast cell already knew to write "partirait"; this is the same
 * sentence and takes the same mood.
 */
function clocksSentence(runway: Runway, forecast: Forecast, measured: boolean): string {
  const projected = forecast.insufficient_reason === null;

  const opening =
    measured || projected
      ? "Ces deux panneaux partent du même solde, mais pas de la même date."
      : "Ces deux panneaux partiraient du même solde, mais pas de la même date.";

  const runwayClause = measured
    ? `L'autonomie est comptée depuis le ${frenchDate(runway.projected_from)}, la date du jour.`
    : `L'autonomie serait comptée depuis le ${frenchDate(runway.projected_from)}, la date du jour, mais aucun rythme n'a pu être mesuré.`;

  const forecastClause = projected
    ? `La prévision part du ${frenchDate(forecast.projected_from)}, dernière date de votre historique : c'est la seule période sur laquelle vos relevés peuvent se prononcer.`
    : `La prévision partirait du ${frenchDate(forecast.projected_from)}, dernière date de votre historique, mais elle n'est pas établie : la raison est donnée avec la projection.`;

  return `${opening} ${runwayClause} ${forecastClause}`;
}

/** "2026-02" → "février 2026". */
function monthLongLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * At lg (12 columns): the balance beside the two runway scenarios, then the
 * projection full width underneath. The balance cell is the narrow one — it
 * carries a single figure — while the runway cell holds two scenario panels
 * side by side plus everything qualifying them.
 */
const SPAN = {
  balance: { base: 1, md: 6, lg: 4 },
  runway: { base: 1, md: 6, lg: 8 },
  forecast: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

interface LoadErrors {
  forecast?: string;
  runway?: string;
}

export function CashflowPage() {
  const reduced = useReducedMotion();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [errors, setErrors] = useState<LoadErrors>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // `allSettled`, not `all`: these are two independent questions behind two
      // independent routes, and one of them failing is no reason to blank the
      // other. Each failure is reported against the panel it belongs to.
      const [forecastResult, runwayResult] = await Promise.allSettled([
        api.get<Forecast>("/cashflow/forecast"),
        api.get<Runway>("/cashflow/runway"),
      ]);
      if (cancelled) return;

      const nextErrors: LoadErrors = {};
      if (forecastResult.status === "fulfilled") {
        setForecast(forecastResult.value);
      } else {
        setForecast(null);
        nextErrors.forecast = messageFor(forecastResult.reason);
      }
      if (runwayResult.status === "fulfilled") {
        setRunway(runwayResult.value);
      } else {
        setRunway(null);
        nextErrors.runway = messageFor(runwayResult.reason);
      }
      setErrors(nextErrors);
      setIsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyed and labelled by which half failed, not by the message. A database
  // outage takes both routes down with the same `detail`, which as a bare
  // repeated sentence is a duplicate React key and tells the reader nothing
  // about which of the two panels is the one that is missing.
  const errorEntries: Array<{ field: "forecast" | "runway"; label: string; message: string }> = [
    { field: "runway" as const, label: "Autonomie indisponible", message: errors.runway },
    { field: "forecast" as const, label: "Prévision indisponible", message: errors.forecast },
  ].filter((entry): entry is { field: "forecast" | "runway"; label: string; message: string } =>
    Boolean(entry.message),
  );

  // Both routes report the same `liquid_balance_cents`; the runway calls it
  // `balance_cents` and the forecast `opening_balance_cents`. Either answers
  // the question, so a failure on one side still leaves the figure on screen.
  const balanceCents = runway?.balance_cents ?? forecast?.opening_balance_cents ?? null;

  // Requirement 1: the two panels start from the same balance on two different
  // dates — the forecast on the ledger's last transaction date, the runway on
  // the real clock (see `api/cashflow.py`'s module docstring). Only worth
  // saying when they actually differ; on a freshly imported ledger they do not.
  const clocksDiverge =
    forecast !== null && runway !== null && forecast.projected_from !== runway.projected_from;

  // Whether EITHER scenario produced a rate — a different question from
  // whether the payload arrived. Below three observed months both come back
  // null (`runway.py` via `capacity.py`), and so do two healthy-looking
  // scenarios whose medians are not positive burns. Every sentence in the cell
  // that speaks of a "rythme mesuré" is gated on this, not on `runway`.
  const runwayMeasured =
    runway !== null && (runway.normal !== null || runway.essentials !== null);

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de la trésorerie">
        {/* Same class as the loaded cell: without it the skeleton stretches to
            the row at lg while the loaded cell sizes to its content, and the
            card visibly shrinks the moment the data lands. */}
        <BentoCell span={SPAN.balance} className="yd-panel yd-cashflow__balance-cell">
          <div className="yd-skeleton yd-skeleton--cf-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--cf-balance" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.runway} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--cf-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--cf-scenarios" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.forecast} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--cf-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--cf-chart" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.balance}
          className="yd-panel yd-cashflow__balance-cell"
          {...entryProps(reduced)}
        >
          <PanelHead icon={CoinsIcon}>Solde disponible</PanelHead>
          {balanceCents !== null ? (
            <>
              <CountUp
                value={balanceCents}
                format={(cents) => formatCents(cents, { signed: true })}
                className="yd-cashflow__balance"
              />
              {balanceCents <= 0 ? (
                // The engine's `balance_cents <= 0` branch returns a runway of
                // 0 months for both scenarios. Saying why here stops the two
                // "Déjà épuisé" panels reading as a bug.
                //
                // Worded without pointing anywhere: the runway cell is beside
                // this one only from 1200px up, and is stacked underneath at
                // 375 and 768. "ci-contre" was wrong on two of the three
                // widths — the same trap BudgetsPage names as "named, not
                // placed".
                <p className="yd-cashflow__note yd-cashflow__note--strong">
                  Ce solde est négatif ou nul : quel que soit le rythme de dépenses mesuré, il ne
                  reste aucune autonomie à compter.
                </p>
              ) : null}
              <p className="yd-cashflow__note">
                Comptes courants, livrets et espèces. Les placements ne sont pas comptés : les
                vendre est une décision, pas un retrait.
              </p>
            </>
          ) : (
            <p className="yd-cashflow__note">
              Solde indisponible : aucune des deux mesures n'a pu être chargée.
            </p>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.runway} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={ClockIcon}>Combien de temps sans revenu</PanelHead>
          {runway === null ? null : (
            <>
              <p className="yd-cashflow__caption">
                {runwayMeasured
                  ? "Si tout revenu s'arrêtait, au rythme de dépenses mesuré dans vos relevés."
                  : "Si tout revenu s'arrêtait. Aucun des deux rythmes de dépenses n'a pu être mesuré dans vos relevés."}
              </p>

              <div className="yd-cashflow__scenarios">
                {/* Requirement 5: each panel gets its OWN reason. `essentials`
                    is measured over a different, self-selected set of months
                    and fails on its own. */}
                <RunwayPanel
                  scenario={runway.normal}
                  label="Rythme actuel"
                  unavailableReason={runway.normal_unavailable_reason}
                />
                <RunwayPanel
                  scenario={runway.essentials}
                  label="Dépenses réduites à l'essentiel"
                  unavailableReason={runway.essentials_unavailable_reason}
                />
              </div>

              {/* Requirement 3: the ledger's calendar span and the months that
                  could actually be measured are two different populations. A
                  thirteen-month ledger with a nine-month import hole looks
                  identical to a dense three-month one without both numbers. */}
              <p className="yd-cashflow__note" data-testid="yd-runway-scope">
                {runwayScopeSentence(runway, runwayMeasured)}
              </p>

              <p className="yd-cashflow__note">
                {runwayAnchorSentence(runway, runwayMeasured)}
              </p>

              <p className="yd-cashflow__note">
                {runway.essential_category_count > 0
                  ? `Le scénario réduit repose sur ${runway.essential_category_count} ${plural(runway.essential_category_count, "catégorie marquée essentielle", "catégories marquées essentielles")}. `
                  : "Aucune catégorie n'est marquée essentielle : le scénario réduit ne repose sur rien. "}
                {/* Not "Modifier cette liste": nothing in the app edits
                    `is_essential` yet — /categories is still a placeholder —
                    and a link promising an editor that does not exist is the
                    same kind of small lie this screen exists to avoid. */}
                Cette liste n'est pas encore modifiable ici ; l'écran{" "}
                <Link to="/budgets">Budgets</Link> signale les catégories concernées.
              </p>
            </>
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.forecast}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={ProjectionIcon}>Prévision sur douze mois</PanelHead>
          {forecast === null ? null : forecast.insufficient_reason !== null ? (
            <>
              {/* Requirement 6: a refusal is a deliberate answer. The backend's
                  own sentence, not a paraphrase — it knows exactly what is
                  missing — and no empty chart beside it. */}
              <p className="yd-cashflow__insufficient">{forecast.insufficient_reason}</p>
              <p className="yd-cashflow__note" data-testid="yd-forecast-scope">
                {`Votre historique compte ${forecast.ledger_months_observed} ${plural(forecast.ledger_months_observed, "mois complet", "mois complets")}, dont ${forecast.months_observed} ${plural(forecast.months_observed, "porte", "portent")} une activité non récurrente — c'est cette seconde mesure qui donnerait sa largeur à la fourchette.`}
              </p>
              {forecast.ledger_last_on !== null ? (
                <p className="yd-cashflow__note">
                  {`La projection partirait du ${frenchDate(forecast.projected_from)}, dernière date de votre historique, et non de la date du jour.`}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <ForecastFanChart
                months={forecast.months}
                thresholdCents={forecast.threshold_cents}
              />

              <p className="yd-cashflow__note yd-cashflow__note--strong">
                {forecast.first_breach_key !== null
                  ? `Le solde pourrait passer sous ${formatCents(forecast.threshold_cents)} dès ${monthLongLabel(forecast.first_breach_key)}.`
                  : `Le solde ne passe sous ${formatCents(forecast.threshold_cents)} sur aucun des mois projetés.`}
              </p>

              {/* Requirement 1, forecast side: the horizon starts the month
                  after the ledger's last transaction, which on a stale ledger
                  is months behind the real calendar. Naming the first projected
                  month is the concrete form of that statement. */}
              <p className="yd-cashflow__note">
                {forecast.ledger_last_on !== null
                  ? `Projection établie à partir du ${frenchDate(forecast.projected_from)}, dernière date de votre historique, et non de la date du jour : les mois projetés commencent en ${monthLongLabel(forecast.months[0].key)}.`
                  : `Projection établie à partir du ${frenchDate(forecast.projected_from)}.`}
              </p>

              <p className="yd-cashflow__note" data-testid="yd-forecast-scope">
                {`Votre historique compte ${forecast.ledger_months_observed} ${plural(forecast.ledger_months_observed, "mois complet", "mois complets")}, dont ${forecast.months_observed} ${plural(forecast.months_observed, "porte", "portent")} une activité non récurrente : c'est sur ces mois que la fourchette est mesurée.`}
              </p>

              <p className="yd-cashflow__note">
                {`${forecast.recurrences_projected} ${plural(forecast.recurrences_projected, "récurrence a été portée", "récurrences ont été portées")} dans la projection. `}
                {/* Detected but not projected is a real gap: an ended or
                    too-young recurrence is deliberately absent from the chart,
                    and a reader comparing this figure with the Récurrences
                    screen must not read the difference as a loss. */}
                Une récurrence terminée, ou trop récente pour être fiable, en est écartée.
              </p>

              <p className="yd-cashflow__note">
                {forecast.seasonality_used
                  ? "La saisonnalité observée est prise en compte : certains mois sont estimés sur les mêmes mois des années précédentes."
                  : "Aucun mois civil n'a été observé assez de fois : la saisonnalité n'est pas prise en compte, chaque mois est estimé au rythme moyen."}
                {forecast.pooled_scale_cents > 0
                  ? ` La bande indique une fourchette, pas une certitude : elle est bâtie sur un écart de ${formatCents(forecast.pooled_scale_cents)} d'un mois à l'autre.`
                  : " La bande indique une fourchette, pas une certitude."}
              </p>
            </>
          )}
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-cashflow">
      <PageHead icon={CashflowIcon} title="Trésorerie" className="yd-cashflow__header">

        <p className="yd-cashflow__lead">
          Combien de temps l'argent disponible tient, et où le solde pourrait aller.
        </p>
      </PageHead>

      {errorEntries.map((entry) => (
        <p role="alert" className="yd-cashflow__alert" key={entry.field}>
          {`${entry.label} : ${entry.message}`}
        </p>
      ))}

      {clocksDiverge && forecast !== null && runway !== null ? (
        <p className="yd-cashflow__clocks" data-testid="yd-cashflow-clocks">
          {clocksSentence(runway, forecast, runwayMeasured)}
        </p>
      ) : null}

      {body}
    </section>
  );
}
