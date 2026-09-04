import { HealthHistoryChart, MIN_HISTORY_POINTS } from "../../charts/HealthHistoryChart";
import { frenchDate } from "../../design/EmptyState";
import { formatRateBps } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { Health, HealthComponent } from "../../lib/types";
import { ScoreGauge } from "./ScoreGauge";

/** U+00A0, the same non-breaking space `formatCents` and `formatRateBps` set
 *  before their unit. "0,0" and "mois" must not fall onto two lines. Written as
 *  an escape so the source carries no invisible character — this exact line
 *  shipped as a plain space once and only the assertion caught it. */
const NBSP = "\u00a0";

/**
 * A ratio of income as a French percentage, through integer basis points.
 *
 * `measured_value` arrives as a float because it is a RATIO, not money — but
 * the two digits after the comma are basis points, and `formatRateBps` already
 * owns that formatting for every rate in this app. Rounding to whole basis
 * points here is the one and only conversion, and it is explicit.
 */
function ratioAsPercent(ratio: number): string {
  return formatRateBps(Math.round(ratio * 10_000));
}

/**
 * The raw figure behind a component's 0-100 score, in the component's OWN
 * unit.
 *
 * Four components share one 0-100 scale, and three of the operator's read
 * exactly 0 on it. Without this line the screen would print "0" three times
 * and say nothing about what was actually measured: a savings rate of
 * −158,39 % of income, essential spending at 266,28 % of income, and a runway
 * of 0,0 month are three very different facts that happen to bottom out on the
 * same index.
 *
 * `null` — never "0 %" — when the component was not measured at all.
 */
export function componentValueLabel(component: HealthComponent): string | null {
  const value = component.measured_value;
  if (value === null) return null;
  switch (component.key) {
    case "savings_rate":
    case "essential_share":
      return `${ratioAsPercent(value)} du revenu médian`;
    case "runway":
      return `${value.toLocaleString("fr-FR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}${NBSP}mois de dépenses essentielles`;
    case "budget_adherence":
      return `${ratioAsPercent(value)} des mois budgétés tenus`;
    default:
      // A component this screen has no unit for is still a real measurement,
      // so the figure is printed bare rather than dropped — silently hiding a
      // measured value would be worse than printing it without its unit.
      return value.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
  }
}

/** The share of the fixed 100-point scale that actually measured. `health.py`
 *  renormalises the blend over exactly this total. */
export function measuredWeight(components: HealthComponent[]): number {
  return components.reduce((total, c) => (c.score === null ? total : total + c.weight), 0);
}

function measuredCount(components: HealthComponent[]): number {
  return components.filter((c) => c.score !== null).length;
}

/** `+12 points`, `−3 points`, or the words for zero. */
function pointsMoved(delta: number): string {
  if (delta === 0) return "Aucun changement";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(delta)} ${plural(Math.abs(delta), "point", "points")}`;
}

/**
 * What moved the score, against the previous STORED snapshot — design §6.2's
 * "avec ce qui l'a fait bouger".
 *
 * `null` when today's own score could not be measured: there is nothing to
 * compare, and the refusal printed beside it already says so.
 *
 * A household on its first day gets a sentence saying exactly that, never
 * "+0 points" — an unchanged score and a score with nothing behind it are two
 * different facts.
 */
export function scoreDeltaSentence(health: Health): string | null {
  if (health.score === null) return null;
  if (health.previous_taken_on === null) {
    return (
      "Premier relevé : aucun score antérieur enregistré à comparer. Le score est enregistré " +
      "au plus une fois par jour, à la lecture de cet écran."
    );
  }
  const since = frenchDate(health.previous_taken_on);
  if (health.score_delta === null) {
    // The contract is "set exactly when previous_taken_on is". Both states at
    // once is a backend defect, and a silent blank would hide it.
    return `Le serveur n'a pas indiqué l'écart avec le relevé du ${since}.`;
  }
  return health.score_delta === 0
    ? `Aucun changement depuis le relevé du ${since}.`
    : `${pointsMoved(health.score_delta)} depuis le relevé du ${since}.`;
}

/**
 * The score itself, and everything that qualifies it.
 *
 * **A measured 0 and an unmeasurable score are two different things and are
 * drawn as two different things.** A measured score is a numeral on a stated
 * scale; an unmeasurable one is the words "Non calculable", with no digit
 * anywhere near it, followed by the engine's own sentence naming which
 * components stood and which did not.
 */
export function HealthScoreSummary({ health }: { health: Health }) {
  const total = health.components.length;
  const measured = measuredCount(health.components);
  const weight = measuredWeight(health.components);
  const delta = scoreDeltaSentence(health);

  return (
    <div className="yd-health">
      <div className="yd-health__figure">
        {health.score === null ? (
          // An empty ring and a ring at zero are two different claims, so an
          // unmeasurable score is not drawn as a gauge at all.
          <p
            className="yd-health__score yd-health__score--absent"
            data-testid="yd-health-score"
          >
            Non calculable
          </p>
        ) : (
          <ScoreGauge score={health.score} />
        )}
      </div>

      {health.unavailable_reason !== null ? (
        <p className="yd-suivi__refusal">{health.unavailable_reason}</p>
      ) : null}

      {health.score !== null ? (
        <p className="yd-health__basis">
          {`Mesuré à partir de ${measured} ${plural(measured, "composante", "composantes")} sur ${total}.`}
        </p>
      ) : null}

      {delta !== null ? <p className="yd-suivi__note">{delta}</p> : null}

      {/* Design §10: the hypotheses travel beside the result. The weights are
          fixed integers that never move with how much data exists — that is
          the property this sentence exists to state, because a score whose
          own scale shifted with the sample size would be worthless. */}
      <p className="yd-suivi__note">
        Les quatre composantes ont des <strong>poids fixes</strong>, jamais ajustés à la quantité
        de données : taux d'épargne 30 %, part des dépenses essentielles 25 %, autonomie
        financière 25 %, adhérence aux budgets 20 %.
        {weight < 100
          ? ` Ce score est calculé sur les ${weight} % du barème qui ont pu être mesurés, redistribués à l'identique.`
          : " Les 100 % du barème ont pu être mesurés."}
      </p>
    </div>
  );
}

interface ComponentListProps {
  components: HealthComponent[];
  /** The date the deltas are against. `null` on a first reading, and then no
   *  per-component delta is printed at all: `HealthScoreSummary` already says
   *  once that there is no earlier snapshot, and repeating it on four rows
   *  would be the same fact printed five times. */
  previousTakenOn?: string | null;
}

export function HealthComponentList({ components, previousTakenOn = null }: ComponentListProps) {
  return (
    <ul className="yd-hcomps">
      {components.map((component) => {
        const value = componentValueLabel(component);
        return (
          <li
            key={component.key}
            className={`yd-hcomp${component.score === null ? " yd-hcomp--absent" : ""}`}
            data-testid={`yd-hcomp-${component.key}`}
          >
            <div className="yd-hcomp__head">
              <h3 className="yd-hcomp__label">{component.label}</h3>
              {/* Stated even when nothing was measured: the weight belongs to
                  the score's design, not to this reading. */}
              <span className="yd-hcomp__weight">{`${component.weight} % du barème`}</span>
            </div>

            {component.score === null ? (
              <>
                {/* NOT a track at zero. There is no scale here at all, because
                    nothing was placed on one. */}
                <p className="yd-hcomp__absent-band">Non mesurée</p>
                <p className="yd-suivi__refusal">{component.unavailable_reason}</p>
                <p className="yd-suivi__note">
                  {`Ses ${component.weight} % ont été répartis sur les composantes mesurées : cette composante ne compte donc ni pour ni contre le score.`}
                </p>
              </>
            ) : (
              <>
                <div className="yd-hcomp__gauge">
                  {/* The track sits in a grid row with a definite inline size
                      (see SuiviPage.css). A percentage width in an auto-width
                      flex column resolves against nothing and renders at ZERO
                      — which here would be indistinguishable from the score
                      this very row is drawing. */}
                  <div
                    className="yd-hcomp__track"
                    role="meter"
                    aria-label={component.label}
                    aria-valuenow={component.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${component.score} sur 100${value === null ? "" : `, soit ${value}`}`}
                  >
                    <div
                      className="yd-hcomp__fill"
                      style={{ width: `${component.score}%` }}
                      data-testid={`yd-hcomp-fill-${component.key}`}
                    />
                  </div>
                  <span
                    className="yd-hcomp__score"
                    data-testid={`yd-hcomp-score-${component.key}`}
                  >
                    {component.score}
                    <span className="yd-hcomp__score-unit">/100</span>
                  </span>
                </div>
                {value !== null ? <p className="yd-hcomp__value">{value}</p> : null}
              </>
            )}

            {previousTakenOn !== null ? (
              <p className="yd-hcomp__delta" data-testid={`yd-hcomp-delta-${component.key}`}>
                {component.delta_score === null
                  ? // `delta_score` is null exactly when one of the two
                    // readings is missing — never when both measured. Saying
                    // which is impossible from here, so it says only what is
                    // certain.
                    `Écart non calculable avec le relevé du ${frenchDate(previousTakenOn)} : l'une des deux mesures manque.`
                  : `${pointsMoved(component.delta_score)} depuis le ${frenchDate(previousTakenOn)}.`}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The score over time — design §6.2's "suivis dans le temps".
 *
 * Three states, and only one of them is a chart. A single stored reading is
 * not a history, and drawing an axis through it would claim a trend nobody
 * measured; an empty history is not a flat line at zero, it is a score that
 * has never once been calculable.
 */
export function HealthHistoryPanel({ health }: { health: Health }) {
  const { history } = health;

  if (history.length === 0) {
    return (
      <p className="yd-suivi__note">
        Aucun relevé n'a encore pu être enregistré : le score n'est mémorisé que les jours où il
        a pu être calculé, et il ne l'a encore jamais été.
      </p>
    );
  }

  if (history.length < MIN_HISTORY_POINTS) {
    const only = history[0];
    return (
      <p className="yd-suivi__note">
        {`Un seul relevé pour l'instant, celui du ${frenchDate(only.taken_on)} : ${only.score} sur 100. Le score est enregistré au plus une fois par jour, à la lecture de cet écran — la courbe commence au deuxième relevé.`}
      </p>
    );
  }

  return (
    <>
      <HealthHistoryChart history={history} />
      <p className="yd-suivi__note">
        {`${history.length} relevés enregistrés, un par jour d'ouverture de cet écran au plus. Les jours sans relevé ne sont pas des zéros : ils ne sont pas mesurés, et l'axe ne les invente pas.`}
      </p>
    </>
  );
}
