import { Link } from "react-router";

import { EmptyState, frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { GoalProgress } from "../../lib/types";

/** U+00A0. French sets one before "%", and a plain space lets "25" and "%"
 *  fall onto two lines of a chip at 375px. */
const NBSP = "\u00a0";

/**
 * The consumed share as a whole percentage, clamped into [0, 100].
 *
 * `width: NaN%` is a declaration React drops, and the fill then falls back to
 * `width: auto` — a FULL bar on an unknown, which is the worst lie this panel
 * could tell. The unknown is drawn as nothing instead. Same guard, and the
 * same reasoning, as `GoalsPage.progressPercent`.
 */
function fillPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(100, Math.max(0, ratio * 100)));
}

/**
 * Design §6.2's "jalons d'objectifs" — read from `engines/goal.py` exactly as
 * phase 2B built it, and never rebuilt here.
 *
 * **A reached milestone carries no date, ever.** `saved_cents` is declared by
 * the household and has no history behind it, so Yieldo genuinely does not
 * know when a threshold was crossed; today's date would claim it happened now.
 * The engine sets `projected_on` to `null` on a reached milestone for that
 * reason, and this panel prints the word rather than inventing the day.
 */
export function MilestonesPanel({ goals }: { goals: GoalProgress[] }) {
  if (goals.length === 0) {
    return (
      <EmptyState
        title="Aucun objectif déclaré."
        detail="Un jalon est un seuil sur un objectif — 25, 50, 75 et 100 % de sa cible. Yieldo ne peut pas deviner qu'une part de votre épargne est destinée à un projet : une somme posée sur un compte ressemble à n'importe quelle autre. Déclarez un objectif et ses jalons apparaissent ici."
      >
        <Link className="yd-suivi__link" to="/objectifs">
          Déclarer un objectif
        </Link>
      </EmptyState>
    );
  }

  return (
    <ul className="yd-jalons">
      {goals.map((goal) => {
        const reached = goal.milestones.filter((m) => m.reached).length;
        const total = goal.milestones.length;
        return (
          <li
            key={goal.goal_id}
            className="yd-jalons__goal"
            data-testid={`yd-jalons-goal-${goal.goal_id}`}
          >
            <div className="yd-jalons__head">
              <h3 className="yd-jalons__name">{goal.name}</h3>
              <span className="yd-jalons__count">
                {`${reached} ${plural(reached, "jalon franchi", "jalons franchis")} sur ${total}`}
              </span>
            </div>

            <p className="yd-jalons__figures">
              <span className="yd-num">{formatCents(goal.saved_cents)}</span>
              {" sur "}
              <span className="yd-num">{formatCents(goal.target_cents)}</span>
            </p>

            {/* The track sits in a grid row with a definite inline size (see
                SuiviPage.css): a percentage width in an auto-width flex column
                resolves against nothing and renders at ZERO. */}
            <div
              className="yd-jalons__track"
              role="progressbar"
              aria-label={`Progression de ${goal.name}`}
              aria-valuenow={fillPercent(goal.progress_ratio)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${formatCents(goal.saved_cents)} sur ${formatCents(goal.target_cents)}`}
            >
              <div
                className="yd-jalons__fill"
                style={{ width: `${fillPercent(goal.progress_ratio)}%` }}
              />
            </div>

            <ol className="yd-jalons__list">
              {goal.milestones.map((milestone) => (
                <li
                  key={milestone.percent}
                  className={`yd-jalon${milestone.reached ? " yd-jalon--reached" : ""}`}
                  data-testid={`yd-jalon-${goal.goal_id}-${milestone.percent}`}
                >
                  <span className="yd-jalon__percent">{`${milestone.percent}${NBSP}%`}</span>
                  <span className="yd-jalon__threshold">
                    {formatCents(milestone.threshold_cents, { decimals: 0 })}
                  </span>
                  <span className="yd-jalon__when">
                    {milestone.reached
                      ? "Atteint"
                      : milestone.projected_on !== null
                        ? frenchDate(milestone.projected_on)
                        : "Non projeté"}
                  </span>
                </li>
              ))}
            </ol>

            {/* Once per goal, verbatim: it names WHICH of four causes stopped
                the projection, and the four remedies are different. */}
            {goal.projection_unavailable_reason !== null ? (
              <p className="yd-suivi__refusal">{goal.projection_unavailable_reason}</p>
            ) : goal.projected_completion_on !== null ? (
              <p className="yd-suivi__note">
                {`Objectif atteint le ${frenchDate(goal.projected_completion_on)} au rythme mesuré.`}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
