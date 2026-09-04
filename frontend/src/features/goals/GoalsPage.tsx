import { motion } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState, frenchDate, historySentence } from "../../design/EmptyState";
import { ArchiveIcon, EditIcon, GoalsIcon, PlusIcon, SavingsIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { GoalProgress, GoalReport, MeasuredRate } from "../../lib/types";
import { GoalForm } from "./GoalForm";
import "./GoalsPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

// U+00A0, the same non-breaking space `design/theme.ts` puts before its "€".
// French sets one before "%" as well, and a plain space lets "25" and "%" fall
// onto two lines of a milestone chip at 375px.
const NBSP = " ";

/**
 * The consumed share as a whole percentage, clamped into [0, 100].
 *
 * **The `NaN` guard is defence in depth and deliberately not dead code.**
 * `target_cents` is `gt=0` on the wire, so `saved / target` should always be a
 * number — but if it ever were not, `width: NaN%` is a declaration React drops,
 * the fill falls back to `width: auto`, and the bar renders FULL. A full bar on
 * an unknown is the worst lie this screen can tell, so the unknown is drawn as
 * nothing rather than as everything.
 *
 * Capped rather than allowed to overflow: an overfunded goal would otherwise
 * draw a bar past its own track. The overfunding is stated in figures instead,
 * by {@link ratioLabel}, which is NOT clamped — the picture and the number are
 * allowed to differ here precisely because only one of them can be read exactly.
 */
export function progressPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(100, Math.max(0, ratio * 100)));
}

/** {@link progressPercent}, as the CSS percentage the fill is sized in. */
export function fillWidth(ratio: number): string {
  return `${progressPercent(ratio)}%`;
}

/**
 * The REAL ratio as a French percentage — never clamped, so an overfunded goal
 * reads "150 %" beside a bar that stops at its track.
 */
export function ratioLabel(ratio: number): string {
  if (!Number.isFinite(ratio)) return "part inconnue";
  return `${Math.round(ratio * 100)}${NBSP}%`;
}

/**
 * Where zero and the median sit inside the measured band, as CSS percentages.
 *
 * The band is the point of the strip: the operator's runs from −3 476,90 € to
 * +1 984,52 €, which **straddles zero**, and a median quoted without that is a
 * certainty the three observations behind it do not support.
 *
 * `null` when the band has no width — `low === high` is a single repeated
 * observation, and dividing by a zero span emits `NaN%`, which React drops,
 * leaving the marker pinned to the left edge as if the median were the band's
 * minimum. A strip that cannot be positioned is not drawn at all.
 *
 * Zero itself is clamped into the track: a band entirely below zero puts the
 * tick flush against the right edge, which is the true picture.
 */
export function bandMarkers(
  rate: MeasuredRate,
): { zero: string; median: string; zeroPercent: number } | null {
  const span = rate.high_cents - rate.low_cents;
  if (!Number.isFinite(span) || span <= 0) return null;
  const percent = (value: number) =>
    Math.min(100, Math.max(0, ((value - rate.low_cents) / span) * 100));
  const zeroPercent = percent(0);
  return {
    zero: `${zeroPercent}%`,
    median: `${percent(rate.median_cents)}%`,
    zeroPercent,
  };
}

/**
 * Whether the zero tick can carry its own "0 €" label.
 *
 * The label is centred on the tick, so within a tenth of either end it would
 * sit on top of the figure already printed there. A band that lies entirely on
 * one side of zero is exactly that case — and it needs no label anyway, since
 * both its printed ends already carry the same sign.
 */
function zeroLabelFits(zeroPercent: number): boolean {
  return zeroPercent > 12 && zeroPercent < 88;
}

/** "1er", "2e", "3e" — the position in the funding queue. */
function ordinal(rank: number): string {
  return rank === 1 ? "1er" : `${rank}e`;
}

/**
 * How many months of statements the rate was measured over.
 *
 * `RunwayPanel`'s wording, kept word for word: "de relevés" and never "mois" on
 * its own, because a screen carrying both a sample size and a duration in
 * months has already confused the two once in this project.
 */
function sampleSentence(rate: MeasuredRate): string {
  return `Rythme mesuré sur ${rate.months} mois de relevés`;
}

/**
 * The band, both ends signed.
 *
 * `RunwayPanel` quotes its band unsigned because a burn is always positive. A
 * savings capacity is not: the operator's band crosses zero, and "Entre
 * −3 476,90 € et 1 984,52 €" hides that the good end is a surplus while the bad
 * end is a deficit.
 */
function bandSentence(rate: MeasuredRate): string {
  return `Entre ${formatCents(rate.low_cents, { signed: true })} et ${formatCents(rate.high_cents, { signed: true })} d'un mois à l'autre`;
}

/**
 * The refusal every goal is carrying, when it is the same one.
 *
 * Causes 1 and 2 — no measurable capacity, and a capacity that is not positive
 * — are properties of the HOUSEHOLD, not of any goal: every goal refuses with
 * the identical sentence. Printing that paragraph once per card says nothing
 * the once does not, and on the operator's own data it would fill the screen
 * three times over. It is hoisted into the capacity panel instead, verbatim,
 * where the cause actually lives.
 *
 * Causes 3 and 4 — past fifty years, and blocked behind a more urgent goal —
 * are properties of ONE goal and must never be hoisted: they name a specific
 * goal's size or a specific blocker. The test is deliberately strict, so they
 * cannot be: every goal must refuse, and with the byte-identical sentence.
 * A single goal refusing while others project is not a household-wide cause.
 */
function sharedRefusal(goals: GoalProgress[]): string | null {
  if (goals.length === 0) return null;
  const first = goals[0].projection_unavailable_reason;
  if (first === null) return null;
  return goals.every((goal) => goal.projection_unavailable_reason === first) ? first : null;
}

/**
 * The goal that has to complete before `goal` starts receiving anything.
 *
 * Funding is sequential, so the wait is the running total of everything ahead:
 * the predecessor is the earlier goal whose completion lands exactly on this
 * one's start. Returns `null` rather than guessing when no such goal is found —
 * an invented name on the screen would be worse than the unnamed sentence.
 */
function blockingPredecessor(goals: GoalProgress[], index: number): string | null {
  const starts = goals[index].funding_starts_in_months;
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    if (goals[earlier].months_to_completion === starts) return goals[earlier].name;
  }
  return null;
}

/**
 * One source of truth for the shape of this screen, so the loading skeletons
 * and the loaded content land on the same cells at the same spans and nothing
 * moves when the data arrives.
 *
 * The capacity spans the full width at every breakpoint, and deliberately: it
 * is the rate every date below is computed from, and on the operator's own data
 * it is the only answer the screen has. A wide cell also gives the band strip
 * the room it needs to show a range that crosses zero.
 */
const SPAN = {
  capacity: { base: 1, md: 6, lg: 12 },
  goals: { base: 1, md: 3, lg: 4 },
} satisfies Record<string, BentoSpan>;

export function GoalsPage() {
  const reduced = useReducedMotion();

  const [report, setReport] = useState<GoalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState<GoalProgress | "new" | null>(null);
  const [pendingArchive, setPendingArchive] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const body = await api.get<GoalReport>("/goals");
        if (cancelled) return;
        setReport(body);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setReport(null);
        setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function archive(goal: GoalProgress) {
    try {
      // DELETE archives rather than deletes: a goal that was reached is worth
      // keeping (api/goals.py).
      await api.delete(`/goals/${goal.goal_id}`);
      setPendingArchive(null);
      setRowError(null);
      setReloadToken((token) => token + 1);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
  }

  const goals = report?.goals ?? [];
  const capacity = report?.capacity ?? null;
  const hoisted = sharedRefusal(goals);

  function renderCapacity(): ReactNode {
    if (report === null) return null;
    const markers = capacity === null ? null : bandMarkers(capacity);

    return (
      <div className="yd-capacity">
        <div className="yd-capacity__figure">
          {capacity === null ? (
            // No figure is invented to stand in for a rate that could not be
            // measured. "0 € par mois" would be a measurement.
            <p className="yd-capacity__amount yd-capacity__amount--words">Non mesurable</p>
          ) : (
            <>
              <p
                className={`yd-capacity__amount${capacity.median_cents <= 0 ? " yd-capacity__amount--negative" : " yd-capacity__amount--positive"}`}
              >
                {formatCents(capacity.median_cents, { signed: true })}
              </p>
              <p className="yd-capacity__unit">par mois, en médiane</p>
              <p className="yd-capacity__sample">{sampleSentence(capacity)}</p>
            </>
          )}
        </div>

        <div className="yd-capacity__detail">
          {capacity !== null && markers !== null ? (
            <>
              {/* Decorative, and marked so: every figure it draws is written
                  out in the sentence directly under it, so a screen reader
                  gets the numbers rather than a strip it cannot read. */}
              <div
                className="yd-capacity__band"
                style={{ "--yd-band-zero": markers.zero } as CSSProperties}
                aria-hidden="true"
              >
                <div className="yd-capacity__band-track">
                  <span className="yd-capacity__band-zero" />
                  <span
                    className="yd-capacity__band-median"
                    style={{ left: markers.median }}
                    data-testid="yd-capacity-median"
                  />
                </div>
                <div className="yd-capacity__band-ends">
                  <span>{formatCents(capacity.low_cents, { signed: true, decimals: 0 })}</span>
                  {/* Without it the red/green boundary is a decoration. With
                      it the strip says where zero falls inside the measured
                      range, which is the whole reason the strip is drawn. */}
                  {zeroLabelFits(markers.zeroPercent) ? (
                    <span className="yd-capacity__band-zero-label">0 €</span>
                  ) : null}
                  <span>{formatCents(capacity.high_cents, { signed: true, decimals: 0 })}</span>
                </div>
              </div>
              <p className="yd-capacity__band-sentence">{bandSentence(capacity)}</p>
            </>
          ) : null}

          {/* The engine's own sentence, verbatim, in the panel the cause
              belongs to. Never paraphrased: it names WHICH of four causes
              applies, and the four remedies are different. */}
          {hoisted !== null ? (
            <p className="yd-goals__refusal">{hoisted}</p>
          ) : capacity === null ? (
            <p className="yd-goals__refusal">
              Votre capacité d'épargne n'a pas encore pu être mesurée : il faut au moins trois mois
              complets de relevés pour en tirer une médiane.
            </p>
          ) : null}

          {capacity !== null && capacity.median_cents <= 0 ? (
            // THE OPERATOR'S OWN STATE, and the reason this branch is written
            // out rather than folded into the one above: the remedy is not the
            // import screen. Saying so outright is the whole point — phase 2A
            // shipped a screen that sent a household to fix a ledger that was
            // not broken.
            <p className="yd-goals__consequence">
              Les deux seules issues sont de dépenser moins ou de gagner plus — importer davantage
              de relevés n'y changerait rien, vos relevés sont complets et c'est bien ce qu'ils
              mesurent.
            </p>
          ) : null}

          {capacity !== null && capacity.median_cents > 0 && goals.length > 0 ? (
            <p className="yd-goals__consequence">
              Vos objectifs sont financés un à la fois, du plus urgent au moins urgent : cette somme
              va entièrement au premier tant qu'il n'est pas atteint, puis au suivant.
            </p>
          ) : null}

          <p className="yd-goals__note">
            {`${report.months_observed} ${plural(report.months_observed, "mois complet", "mois complets")} ${plural(report.months_observed, "observé", "observés")} dans votre historique.`}
            {report.history !== null ? ` ${historySentence(report.history)}` : ""}
          </p>

          {capacity === null ? (
            // The import link belongs to THIS register alone. Offering it
            // beside a negative capacity would point at the wrong repair.
            <Link className="yd-goals__link" to="/import">
              Importer des relevés
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  function renderGoal(goal: GoalProgress, index: number): ReactNode {
    const complete = goal.remaining_cents === 0;
    const predecessor = blockingPredecessor(goals, index);

    return (
      <BentoCell
        as={motion.div}
        key={goal.goal_id}
        span={SPAN.goals}
        className="yd-panel yd-goal"
        data-testid={`yd-goal-${goal.goal_id}`}
        {...entryProps(reduced)}
      >
        <div className="yd-goal__head">
          <h3 className="yd-goal__name">{goal.name}</h3>
          <span className="yd-goal__rank">
            <span className="sr-only">{`${ordinal(index + 1)} dans l'ordre de financement`}</span>
            <span aria-hidden="true">{ordinal(index + 1)}</span>
          </span>
        </div>

        <p className="yd-goal__figures">
          <span className="yd-num">{formatCents(goal.saved_cents)}</span>
          <span className="yd-goal__figures-sep">{" sur "}</span>
          <span className="yd-num">{formatCents(goal.target_cents)}</span>
          <span className="yd-goal__ratio">{ratioLabel(goal.progress_ratio)}</span>
        </p>

        {/* The track sits in a grid row with a definite inline size (see
            GoalsPage.css). A percentage width inside an auto-width flex column
            resolves against nothing and renders at ZERO. */}
        <div
          className="yd-goal__track"
          role="progressbar"
          aria-label={`Progression de ${goal.name}`}
          aria-valuenow={progressPercent(goal.progress_ratio)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${formatCents(goal.saved_cents)} épargnés sur ${formatCents(goal.target_cents)}, soit ${ratioLabel(goal.progress_ratio)}`}
        >
          <div
            className={`yd-goal__fill${complete ? " yd-goal__fill--complete" : ""}`}
            style={{ width: fillWidth(goal.progress_ratio) }}
            data-testid={`yd-goal-fill-${goal.goal_id}`}
          />
        </div>

        <p className="yd-goal__remaining">
          {complete
            ? "Objectif atteint."
            : `Il reste ${formatCents(goal.remaining_cents)} à mettre de côté.`}
        </p>

        <ul className="yd-goal__milestones">
          {goal.milestones.map((milestone) => (
            <li
              key={milestone.percent}
              className={`yd-milestone${milestone.reached ? " yd-milestone--reached" : ""}`}
              data-testid={`yd-milestone-${goal.goal_id}-${milestone.percent}`}
            >
              <span className="yd-milestone__percent">{`${milestone.percent}${NBSP}%`}</span>
              <span className="yd-milestone__threshold">
                {formatCents(milestone.threshold_cents, { decimals: 0 })}
              </span>
              <span className="yd-milestone__when">
                {milestone.reached
                  ? // No date, ever. `saved_cents` is declared with no history
                    // behind it, so Yieldo does not know when the threshold was
                    // crossed; today's date would claim it happened now.
                    "Atteint"
                  : milestone.projected_on !== null
                    ? frenchDate(milestone.projected_on)
                    : "Non projeté"}
              </span>
            </li>
          ))}
        </ul>

        {complete ? (
          // `projected_completion_on` is TODAY on an already-funded goal, not a
          // forecast, and `on_track` compares today against the deadline rather
          // than the day the money actually arrived. Neither is a fact about
          // when this goal was reached, so neither is printed as one.
          goal.due_on !== null ? (
            <p className="yd-goal__deadline">{`Échéance : le ${frenchDate(goal.due_on)}.`}</p>
          ) : null
        ) : (
          <>
            {goal.projected_completion_on !== null && goal.months_to_completion !== null ? (
              <p className="yd-goal__projection">
                {`Atteint le ${frenchDate(goal.projected_completion_on)}, dans ${goal.months_to_completion} mois.`}
              </p>
            ) : hoisted !== null ? (
              // The cause is the household's, not this goal's, and it is
              // printed in full once at the top rather than three times here.
              <p className="yd-goal__projection yd-goal__projection--none">
                Aucune date d'atteinte n'est projetée : voir « Capacité d'épargne mesurée »
                ci-dessus.
              </p>
            ) : goal.projection_unavailable_reason !== null ? (
              // This goal's own refusal — its size, or the goal queued in front
              // of it. Verbatim, because it names which.
              <p className="yd-goals__refusal">{goal.projection_unavailable_reason}</p>
            ) : (
              // The contract is "set exactly when `months_to_completion` is
              // null". Both null at once is a backend defect, and a blank line
              // would hide it.
              <p className="yd-goals__refusal">
                Aucune date n'a été projetée et le serveur n'a pas indiqué pourquoi.
              </p>
            )}

            {goal.funding_starts_in_months > 0 ? (
              <p className="yd-goal__wait">
                {predecessor !== null
                  ? `Ce financement commence dans ${goal.funding_starts_in_months} mois, une fois « ${predecessor} » atteint.`
                  : `Ce financement commence dans ${goal.funding_starts_in_months} mois : les objectifs plus urgents sont financés d'abord.`}
              </p>
            ) : null}

            {goal.due_on !== null ? (
              <p
                className={`yd-goal__deadline${goal.on_track === false ? " yd-goal__deadline--late" : goal.on_track === true ? " yd-goal__deadline--ontrack" : ""}`}
              >
                {goal.on_track === true
                  ? `Échéance le ${frenchDate(goal.due_on)} — dans les temps.`
                  : goal.on_track === false
                    ? `Échéance le ${frenchDate(goal.due_on)} — en retard : la date projetée tombe après.`
                    : // Three states, and null is not false. An accusation
                      // needs a basis, and without a projected date there is
                      // none to compare the deadline with.
                      `Échéance le ${frenchDate(goal.due_on)} — on ne peut pas se prononcer : aucune date d'atteinte n'a pu être projetée.`}
              </p>
            ) : null}
          </>
        )}

        {pendingArchive === goal.goal_id ? (
          <div className="yd-goal__actions">
            <span className="yd-goal__confirm">
              {`Archiver « ${goal.name} » ? Il sortira de la file de financement ; son historique est conservé.`}
            </span>
            <button
              type="button"
              className="yd-goal__action yd-goal__action--danger"
              onClick={() => void archive(goal)}
            >
              Confirmer
            </button>
            <button
              type="button"
              className="yd-goal__action"
              onClick={() => setPendingArchive(null)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <div className="yd-goal__actions">
            {/* The goal's name lives in the accessible name, not in the visible
                label: a screen reader hears which card it is on, and the button
                stays a button rather than a sentence. */}
            <button type="button" className="yd-goal__action" onClick={() => setEditing(goal)}>
              <span className="sr-only">{`Modifier ${goal.name}`}</span>
              <EditIcon />
              <span aria-hidden="true">Modifier</span>
            </button>
            <button
              type="button"
              className="yd-goal__action"
              onClick={() => setPendingArchive(goal.goal_id)}
            >
              <span className="sr-only">{`Archiver ${goal.name}`}</span>
              <ArchiveIcon />
              <span aria-hidden="true">Archiver</span>
            </button>
          </div>
        )}
      </BentoCell>
    );
  }

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement des objectifs">
        <BentoCell span={SPAN.capacity} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--goal-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--goal-capacity" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.goals} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--goal-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--goal-card" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.goals} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--goal-title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--goal-card" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (report === null) {
    body = null;
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.capacity}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={SavingsIcon}>Capacité d'épargne mesurée</PanelHead>
          {renderCapacity()}
        </BentoCell>

        {goals.length === 0 && editing === null ? (
          <BentoCell
            as={motion.div}
            span={SPAN.capacity}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <EmptyState
              title="Aucun objectif."
              detail="Yieldo ne peut pas deviner qu'une part de votre épargne est destinée à un projet : une somme posée sur un compte ressemble à n'importe quelle autre. Un objectif se déclare donc ici, avec son montant visé, ce que vous avez déjà mis de côté et son rang d'urgence."
            >
              <button
                type="button"
                className="yd-empty__action"
                onClick={() => setEditing("new")}
              >
                <PlusIcon />
                Ajouter un objectif
              </button>
            </EmptyState>
          </BentoCell>
        ) : (
          goals.map(renderGoal)
        )}

        {rowError !== null || editing !== null || goals.length > 0 ? (
          <BentoCell
            as={motion.div}
            span={SPAN.capacity}
          data-ai-target="panel-objectifs"
            // Only a card when it holds something: a full-width panel carrying
            // one button and nothing else is a card's worth of empty surface,
            // which reads as content having failed to load.
            className={editing !== null || rowError !== null ? "yd-panel" : "yd-goals__addbar"}
            {...entryProps(reduced)}
          >
            {rowError !== null ? (
              <p role="alert" className="yd-goals__alert">
                {rowError}
              </p>
            ) : null}

            {editing !== null ? (
              <GoalForm
                key={editing === "new" ? "new" : editing.goal_id}
                goal={editing === "new" ? undefined : editing}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  setReloadToken((token) => token + 1);
                }}
              />
            ) : (
              <button type="button" className="yd-goals__add" onClick={() => setEditing("new")}>
                <PlusIcon />
                Ajouter un objectif
              </button>
            )}
          </BentoCell>
        ) : null}
      </BentoGrid>
    );
  }

  return (
    <section className="yd-goals">
      <PageHead icon={GoalsIcon} title="Objectifs" className="yd-goals__header">

        <p className="yd-goals__lead">
          Ce que vous mettez de côté, pour quoi, et ce que votre rythme d'épargne mesuré permet
          réellement d'atteindre — ou ne permet pas.
        </p>
      </PageHead>

      {error !== null ? (
        <p role="alert" className="yd-goals__alert">
          {`Objectifs indisponibles : ${error}`}
        </p>
      ) : null}

      {body}
    </section>
  );
}
