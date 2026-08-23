import { motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { CountUp } from "../../design/CountUp";
import { frenchDate } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type {
  Anomaly,
  AnomalyReport,
  CategoryInflation,
  Inflation,
  PriceIndexPoint,
} from "../../lib/types";
import { formatRatio } from "../recurrences/RecurrenceRow";
import { PeriodSelector } from "../transactions/PeriodSelector";
import { usePeriod } from "../transactions/usePeriod";
import { PriceIndexForm } from "./PriceIndexForm";
import "./AnalysisPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** The anomaly list's own accessible name, exported so the tests assert on the
 *  same string a screen reader announces. */
export const ANOMALY_LIST_LABEL = "Montants inhabituels";
export const SKIPPED_LIST_LABEL = "Groupes non analysés";

/**
 * `SkippedCategory.direction` carries a SIGN group — "expense" / "income" —
 * not `Anomaly.direction`'s high/low vocabulary. Scoring splits every category
 * in two before it ever asks whether a value sits high or low, so one category
 * can be skipped on its expenses and scored on its income; naming the side is
 * what stops the two rows reading as a duplicate.
 */
const SIGN_LABEL: Record<string, string> = { expense: "dépenses", income: "recettes" };

/**
 * `inflation.MIN_MONTHS_PER_WINDOW`, repeated here only to *name* it once in
 * French copy above the list of incomparable categories — and to decide
 * whether a line's month counts explain its exclusion on their own.
 *
 * Nothing on this screen is computed from it: the verdict itself travels on
 * the wire as `comparable`, and every line still carries the engine's own
 * `reason`. Same arrangement as `RecurrenceRow`'s `ANNUALISATION_FLOOR_DAYS`
 * — a change of floor on the backend cannot leave the screen applying the old
 * one, it can only leave this sentence naming the wrong number, which is
 * visible on screen.
 */
export const MIN_MONTHS_PER_WINDOW = 3;

/**
 * Whether a line's two month counts are the whole reason it could not be
 * compared.
 *
 * The engine writes one sentence per incomparable line, and on a ledger like
 * the operator's that is seventeen paragraphs differing in two digits — a wall
 * nobody reads, which is its own kind of dishonesty. So the shared half is
 * stated once above the list and each line shows only its own two counts.
 *
 * That factoring is only faithful while the counts really are the whole story.
 * `compute_inflation` also refuses a previous-side cost of zero, which it
 * documents as unreachable through its own filtering but keeps as a guard; a
 * line failing THAT test would show "3 mois et 3 mois" under a rule asking for
 * three, and read as a bug. Here the engine's own sentence is printed instead.
 */
function countsExplain(line: CategoryInflation): boolean {
  return line.months_current < MIN_MONTHS_PER_WINDOW || line.months_previous < MIN_MONTHS_PER_WINDOW;
}

/** A line's two month counts, as a statement of the payload and nothing more. */
function monthsSentence(line: CategoryInflation): string {
  return `${line.months_current} mois récents · ${line.months_previous} un an plus tôt`;
}

function signLabel(direction: string): string {
  return SIGN_LABEL[direction] ?? direction;
}

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

/**
 * The two windows, in the mood the comparison has earned.
 *
 * A refusal still names them: "il n'y a pas assez de données" without saying
 * over which two periods sends the reader looking for statements they may
 * already have imported.
 */
function windowSentence(inflation: Inflation): string {
  const verb = inflation.comparable ? "porte" : "porterait";
  return (
    `La comparaison ${verb} sur le ${frenchDate(inflation.current_from)} – ` +
    `${frenchDate(inflation.current_to)}, face à la même période un an plus tôt : ` +
    `le ${frenchDate(inflation.previous_from)} – ${frenchDate(inflation.previous_to)}.`
  );
}

/**
 * The reference index, in the three states it actually has.
 *
 * `reference_ratio` is null for two different reasons and they are not the
 * same message: nothing has ever been pasted, or a series is stored and does
 * not reach both windows. Only `indexPoints` tells them apart. A zero is never
 * printed for either — an absent comparison is not a comparison showing no
 * change.
 *
 * A failed *load* of the index is a third state again: there, the screen knows
 * nothing about what is stored and must not claim nothing is.
 */
function referenceSentence(
  inflation: Inflation,
  indexPoints: PriceIndexPoint[],
  indexUnavailable: boolean,
): string {
  if (inflation.reference_ratio !== null) {
    return (
      `Indice de référence sur les mêmes périodes : ${formatRatio(inflation.reference_ratio)}. ` +
      `C'est l'évolution de la série que vous avez saisie vous-même, pas la vôtre.`
    );
  }
  if (indexUnavailable) {
    return "L'indice de référence n'a pas pu être chargé : impossible de dire ce qui est enregistré.";
  }
  if (indexPoints.length === 0) {
    return (
      "Aucune comparaison extérieure : vous n'avez saisi aucun indice de référence, et aucun " +
      "zéro ne prend sa place."
    );
  }
  return (
    "Un indice de référence est saisi, mais la série ne couvre pas les deux périodes " +
    "comparées : aucune comparaison extérieure n'est possible."
  );
}

/**
 * What the basket is summed over. `basket_*_cost_cents` add up the COMPARABLE
 * lines and nothing else, so a reader who totals the category list by hand
 * gets a different figure unless this is said.
 */
function basketScopeSentence(comparable: number, rest: number): string {
  const head = `${comparable} ${plural(comparable, "catégorie entre", "catégories entrent")} dans ce panier`;
  if (rest === 0) return `${head}.`;
  return (
    `${head} ; ${rest} ` +
    `${plural(rest, "n'a pas pu être comparée et n'y figure pas", "n'ont pas pu être comparées et n'y figurent pas")}.`
  );
}

/**
 * One anomaly, in a sentence that does the subtraction so the reader does not.
 *
 * `category_median_cents` is an unsigned magnitude while `amount_cents` is
 * signed (see both fields' docstrings in `engines/anomaly.py`): printed side by
 * side, "−900,00 €" and "40,00 €" invite an arithmetic that gives −940,00 €,
 * which is not a figure this ledger ever stated. The gap is stated outright,
 * computed the way the engine's own ranking metric computes it.
 */
function anomalySentence(item: Anomaly): string {
  const isExpense = item.amount_cents < 0;
  const kind = isExpense ? "Dépense" : "Recette";
  const noun = isExpense ? "dépense" : "recette";
  const gap = Math.abs(Math.abs(item.amount_cents) - item.category_median_cents);
  const way = item.direction === "high" ? "de plus" : "de moins";
  const category = item.category_name ?? "Non catégorisé";
  return (
    `${kind} du ${frenchDate(item.date)} · ${category} — habituellement ` +
    `${formatCents(item.category_median_cents)} pour une ${noun} de cette catégorie, ` +
    `celle-ci s'en écarte de ${formatCents(gap)} ${way}.`
  );
}

/**
 * What "rien à signaler" means here, which is three different things.
 *
 * `scored_groups === 0` alone cannot say whether the ledger holds no category
 * with enough history or whether the window on screen is simply empty — the
 * whole report is window-scoped, so an empty window empties `skipped` too.
 * Telling the reader "no category has enough history" over an empty August is
 * a diagnosis of the wrong illness.
 */
function nothingFoundSentence(report: AnomalyReport): string {
  if (report.scored_groups === 0 && report.skipped.length === 0) {
    return (
      "Aucune opération sur cette période : il n'y a rien à examiner. Élargissez la période " +
      "ou importez des relevés qui la couvrent."
    );
  }
  if (report.scored_groups === 0) {
    return (
      "Aucun groupe n'a assez d'historique pour juger qu'un montant sort de l'ordinaire. " +
      "Chacun dit pourquoi dans « groupes non analysés »."
    );
  }
  return `Aucun montant inhabituel sur la période, sur ${report.scored_groups} ${plural(
    report.scored_groups,
    "groupe analysé",
    "groupes analysés",
  )}.`;
}

/**
 * Requirement 4, said out loud. `skipped` and `scored_groups` are scoped to the
 * window; the median and dispersion each group was judged against are not —
 * they read the group's whole history. A sentence that let the reader think a
 * category had been judged on the fortnight on screen would make every zoom
 * look like it changed the verdict.
 */
function anomalyScopeSentence(report: AnomalyReport): string {
  return (
    `${report.scored_groups} ${plural(report.scored_groups, "groupe analysé", "groupes analysés")} ` +
    `sur la période du ${frenchDate(report.date_from)} au ${frenchDate(report.date_to)} — chaque ` +
    `catégorie est examinée séparément pour ses dépenses et pour ses recettes. L'habitude de ` +
    `chaque groupe, elle, est mesurée sur tout votre historique et jamais sur la seule période ` +
    `affichée : restreindre la période ne rend pas une dépense ordinaire inhabituelle.`
  );
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * At lg (12 columns): the basket's own figure beside the per-category list
 * (5 / 7), then the anomaly feed beside the index form (7 / 5). The two lists
 * get the wider column of their row because they carry rows plus everything
 * qualifying them; the basket is one figure and the index form is one
 * textarea.
 */
const SPAN = {
  basket: { base: 1, md: 6, lg: 5 },
  lines: { base: 1, md: 6, lg: 7 },
  anomalies: { base: 1, md: 6, lg: 7 },
  index: { base: 1, md: 6, lg: 5 },
} satisfies Record<string, BentoSpan>;

interface LoadErrors {
  inflation?: string;
  anomalies?: string;
  index?: string;
}

const ERROR_LABELS: Record<keyof LoadErrors, string> = {
  inflation: "Inflation personnelle indisponible",
  anomalies: "Détection d'anomalies indisponible",
  index: "Indice de référence indisponible",
};

export function AnalysisPage() {
  // "all" rather than the hook's own "month" default: with no bound sent, each
  // backend route resolves the window it can actually answer over — the last
  // twelve complete calendar months of the ledger for inflation, the ledger's
  // own span for anomalies. Opened on the real calendar month, a ledger whose
  // statements stop in January answers both questions about an empty August
  // and states a cause that is not the real one.
  const period = usePeriod("all");
  const reduced = useReducedMotion();

  const [inflation, setInflation] = useState<Inflation | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyReport | null>(null);
  const [indexPoints, setIndexPoints] = useState<PriceIndexPoint[]>([]);
  const [errors, setErrors] = useState<LoadErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // `allSettled`, not `all`: three independent questions behind three
      // independent routes, and one failing is no reason to blank the others.
      // Each failure is reported against the panel it belongs to.
      const [inflationResult, anomalyResult, indexResult] = await Promise.allSettled([
        api.get<Inflation>("/analysis/inflation", { date_from: period.from, date_to: period.to }),
        api.get<AnomalyReport>("/analysis/anomalies", {
          date_from: period.from,
          date_to: period.to,
        }),
        api.get<PriceIndexPoint[]>("/analysis/price-index"),
      ]);
      if (cancelled) return;

      const nextErrors: LoadErrors = {};
      if (inflationResult.status === "fulfilled") setInflation(inflationResult.value);
      else {
        setInflation(null);
        nextErrors.inflation = messageFor(inflationResult.reason);
      }
      if (anomalyResult.status === "fulfilled") setAnomalies(anomalyResult.value);
      else {
        setAnomalies(null);
        nextErrors.anomalies = messageFor(anomalyResult.reason);
      }
      if (indexResult.status === "fulfilled") setIndexPoints(indexResult.value);
      else {
        setIndexPoints([]);
        nextErrors.index = messageFor(indexResult.reason);
      }
      setErrors(nextErrors);
      setIsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to, reloadToken]);

  // Saving the index changes what `reference_ratio` can be, so the inflation
  // route is asked again — not just the index itself.
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // Keyed and labelled by which route failed, never by the message: a database
  // outage takes all three down with the same `detail`, which as a bare
  // repeated sentence is a duplicate React key and says nothing about which
  // half of the screen is missing.
  const errorEntries = (Object.keys(ERROR_LABELS) as Array<keyof LoadErrors>)
    .map((field) => ({ field, label: ERROR_LABELS[field], message: errors[field] }))
    .filter((entry): entry is { field: keyof LoadErrors; label: string; message: string } =>
      Boolean(entry.message),
    );

  // `ratio !== null` as well as `comparable`, so the two lists are exhaustive
  // and the ratio rendered below is known to exist. The engine sets them
  // together — `comparable` implies a ratio — but a line that ever arrived
  // flagged comparable with no ratio has to fall to the "cannot be compared"
  // side rather than reach `formatRatio(null)`.
  const comparableLines =
    inflation?.lines.filter(
      (line): line is CategoryInflation & { ratio: number } =>
        line.comparable && line.ratio !== null,
    ) ?? [];
  const incomparableLines =
    inflation?.lines.filter((line) => !line.comparable || line.ratio === null) ?? [];

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de l'analyse">
        <BentoCell span={SPAN.basket} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--an-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--an-figure" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.lines} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--an-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--an-list" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.anomalies} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--an-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--an-list" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.index} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--an-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--an-form" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.basket}
          className="yd-panel"
          data-testid="yd-analysis-basket"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Votre panier</h2>
          {inflation === null ? (
            <p className="yd-analysis__note">Ce panneau n'a pas pu être chargé.</p>
          ) : inflation.comparable && inflation.basket_ratio !== null ? (
            <>
              <CountUp
                value={inflation.basket_ratio}
                format={formatRatio}
                className="yd-analysis__ratio"
              />
              <p className="yd-analysis__note yd-analysis__note--strong">
                {`Coût mensuel médian : ${formatCents(inflation.basket_previous_cost_cents)} un an plus tôt, ${formatCents(inflation.basket_current_cost_cents)} sur la période récente.`}
              </p>
              <p className="yd-analysis__note">{windowSentence(inflation)}</p>
              <p className="yd-analysis__note">
                {basketScopeSentence(comparableLines.length, incomparableLines.length)}
              </p>
              <p className="yd-analysis__note">
                {referenceSentence(inflation, indexPoints, Boolean(errors.index))}
              </p>
            </>
          ) : (
            <>
              {/* A refusal is content, not an error: the engine's own sentence,
                  and no figure beside it. `basket_*_cost_cents` are 0 here
                  because they sum the comparable lines and there are none —
                  printing "0,00 €" would state that the basket costs nothing. */}
              <p className="yd-analysis__insufficient">
                {inflation.reason ??
                  "Aucune comparaison n'a pu être établie sur ces deux périodes."}
              </p>
              <p className="yd-analysis__note">{windowSentence(inflation)}</p>
              <p className="yd-analysis__note">
                {`${inflation.lines.length} ${plural(inflation.lines.length, "catégorie examinée", "catégories examinées")}, aucune comparable sur ces deux périodes. Chacune dit ce qui lui manque.`}
              </p>
              <p className="yd-analysis__note">
                {referenceSentence(inflation, indexPoints, Boolean(errors.index))}
              </p>
            </>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.lines} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Où l'argent part davantage qu'avant</h2>
          {inflation === null ? (
            <p className="yd-analysis__note">Ce panneau n'a pas pu être chargé.</p>
          ) : inflation.lines.length === 0 ? (
            <p className="yd-analysis__note">
              Aucune dépense sur les deux périodes comparées. Élargissez la période ou importez
              des relevés supplémentaires.
            </p>
          ) : (
            <>
              {comparableLines.length > 0 ? (
                <>
                  <p className="yd-analysis__note">
                    Chaque catégorie comparée à elle-même un an plus tôt, coût mensuel médian
                    contre coût mensuel médian. De la plus forte hausse à la plus forte baisse.
                  </p>
                  <ul
                    className="yd-analysis__lines"
                    aria-label="Catégories comparables"
                  >
                    {comparableLines.map((line) => (
                      <li
                        key={line.category_id ?? "uncategorized"}
                        data-testid={`yd-analysis-line-${line.category_id ?? "none"}`}
                        className="yd-analysis__line"
                      >
                        <span className="yd-analysis__line-name">{line.name}</span>
                        {/* No cast: the filter above is a type predicate, so
                            `ratio` is a number here by construction. */}
                        <span className="yd-analysis__line-ratio yd-num">
                          {formatRatio(line.ratio)}
                        </span>
                        <span className="yd-analysis__line-detail">
                          {`${formatCents(line.previous_cost_cents)} → ${formatCents(line.current_cost_cents)} par mois, sur ${line.months_previous} puis ${line.months_current} ${plural(line.months_current, "mois observé", "mois observés")}.`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="yd-analysis__note">
                  Aucune catégorie n'est comparable sur ces deux périodes.
                </p>
              )}

              {incomparableLines.length > 0 ? (
                // Open by default when there is nothing else in the panel: on a
                // ledger where every line is incomparable, a closed disclosure
                // would leave the cell holding one sentence and a triangle.
                <details
                  className="yd-analysis__disclosure"
                  open={comparableLines.length === 0}
                >
                  <summary>
                    {`${incomparableLines.length} ${plural(incomparableLines.length, "catégorie non comparable", "catégories non comparables")}`}
                  </summary>
                  {/* Requirement 5. These lines carry a real, non-zero cost on
                      at least one side and a delta that looks like a change.
                      None of the three is rendered: what is measured on one
                      side alone says nothing about an evolution, and a category
                      absent from one window did not see its price fall to
                      zero. */}
                  <p className="yd-analysis__note">
                    {`Elles restent affichées, jamais supprimées ni ramenées à −100 % : une catégorie absente d'une des deux périodes n'a pas vu son prix tomber à zéro, elle n'a simplement pas de quoi être comparée. Aucun coût n'est affiché pour ces lignes. Il en faut au moins ${MIN_MONTHS_PER_WINDOW} mois de dépenses dans chacune des deux périodes ; chaque ligne donne les siens.`}
                  </p>
                  <ul className="yd-analysis__lines" aria-label="Catégories non comparables">
                    {incomparableLines.map((line) => (
                      <li
                        key={line.category_id ?? "uncategorized"}
                        data-testid={`yd-analysis-line-${line.category_id ?? "none"}`}
                        className="yd-analysis__line yd-analysis__line--incomparable"
                      >
                        <span className="yd-analysis__line-name">{line.name}</span>
                        <span className="yd-analysis__line-months yd-num">
                          {monthsSentence(line)}
                        </span>
                        {countsExplain(line) ? null : (
                          <span className="yd-analysis__line-reason">
                            {line.reason ??
                              "Aucune comparaison honnête n'est possible pour cette catégorie."}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.anomalies}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">{ANOMALY_LIST_LABEL}</h2>
          {anomalies === null ? (
            <p className="yd-analysis__note">Ce panneau n'a pas pu être chargé.</p>
          ) : (
            <>
              {/* Requirement 1. Two of this engine's correct answers look like
                  accusations without this paragraph, and both are reachable on
                  ordinary data: a size-based exemption for the annual premium
                  would be exactly the arbitrary threshold the design forbids,
                  and the six-cent case is what "cannot say" turning into "can
                  say" looks like the moment a never-varying charge varies. */}
              <p className="yd-analysis__caption">
                Une anomalie n'est pas un reproche. C'est une opération qui s'écarte de
                l'historique de sa propre catégorie, rien de plus : une prime d'assurance
                annuelle au milieu de petites mensualités y figure, et dans une catégorie dont
                les montants ne bougent jamais, six centimes d'écart suffisent à faire
                apparaître une ligne.
              </p>

              {anomalies.anomalies.length === 0 ? (
                <p className="yd-analysis__note yd-analysis__note--strong">
                  {nothingFoundSentence(anomalies)}
                </p>
              ) : (
                <>
                  <ul className="yd-analysis__anomalies" aria-label={ANOMALY_LIST_LABEL}>
                    {anomalies.anomalies.map((item) => (
                      <li
                        key={item.transaction_id}
                        data-testid={`yd-analysis-anomaly-${item.transaction_id}`}
                        className="yd-analysis__anomaly"
                      >
                        <span className="yd-analysis__anomaly-label">{item.label}</span>
                        <span className="yd-analysis__anomaly-amount yd-num">
                          {formatCents(item.amount_cents, { signed: true })}
                        </span>
                        <span className="yd-analysis__anomaly-detail">
                          {anomalySentence(item)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* Requirement 2. The order is the payload's and is never
                      recomputed here. `modified_z` decided whether each row
                      belongs in the list at all and is not printed anywhere:
                      shown beside the rows it would read as the ranking, which
                      is the one thing it is not. */}
                  {anomalies.anomalies.length > 1 ? (
                    <p className="yd-analysis__note">
                      Classées par écart en euros, du plus grand au plus petit : c'est l'argent
                      réellement déplacé. Le score statistique décide seulement qu'une opération
                      figure dans cette liste, il ne la classe pas.
                    </p>
                  ) : null}
                </>
              )}

              <p className="yd-analysis__note">{anomalyScopeSentence(anomalies)}</p>

              {anomalies.skipped.length > 0 ? (
                <details className="yd-analysis__disclosure">
                  <summary>
                    {`${anomalies.skipped.length} ${plural(anomalies.skipped.length, "groupe non analysé", "groupes non analysés")} sur cette période`}
                  </summary>
                  <ul className="yd-analysis__skipped" aria-label={SKIPPED_LIST_LABEL}>
                    {anomalies.skipped.map((entry) => (
                      <li key={`${entry.category_id ?? "none"}-${entry.direction}`}>
                        <strong>{entry.name}</strong>
                        {` (${signLabel(entry.direction)}) — ${entry.reason}`}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.index}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Indice de référence</h2>
          <PriceIndexForm points={indexPoints} onSaved={reload} />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-analysis">
      <div className="yd-analysis__header">
        <h1>Analyse</h1>
        <p className="yd-analysis__lead">
          Ce qui a changé : le prix de votre propre panier d'une année sur l'autre, et les
          montants qui sortent de l'ordinaire pour leur catégorie.
        </p>
      </div>

      <PeriodSelector period={period} />

      {/* The selector governs both panels, but "Tout" does not mean the same
          window on each side, and neither engine can honestly stretch to the
          other's. Said here once; each panel then names the period it actually
          used. */}
      <p className="yd-analysis__scope">
        {period.preset === "all"
          ? "Aucune période imposée : l'inflation compare les douze derniers mois complets de votre historique — au-delà, la période et celle d'un an plus tôt se chevaucheraient — tandis que les anomalies couvrent tout l'historique. Chaque panneau nomme la période qu'il a réellement utilisée."
          : "Les deux panneaux répondent sur la période choisie ci-dessus, et chacun nomme celle qu'il a réellement utilisée. L'inflation la compare à la même période un an plus tôt, ce qui lui interdit de dépasser douze mois."}
      </p>

      {errorEntries.map((entry) => (
        <p role="alert" className="yd-analysis__alert" key={entry.field}>
          {`${entry.label} : ${entry.message}`}
        </p>
      ))}

      {body}
    </section>
  );
}
