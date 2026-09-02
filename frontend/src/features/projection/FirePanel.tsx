import { frenchDate } from "../../design/EmptyState";
import { formatCents, formatRateBps } from "../../design/theme";
import type { FireProjection } from "../../lib/types";

/** "137 mois" as the years and months a household actually thinks in. */
export function monthsSentence(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years === 0 ? "" : years === 1 ? "1 an" : `${years} ans`;
  const monthPart = rest === 0 ? "" : rest === 1 ? "1 mois" : `${rest} mois`;
  if (yearPart === "") return monthPart === "" ? "moins d'un mois" : monthPart;
  return monthPart === "" ? yearPart : `${yearPart} et ${monthPart}`;
}

const REGIME_NAMES: Record<string, string> = {
  pfu: "PFU (30 %)",
  bareme: "barème progressif",
};

/**
 * FIRE: the capital a stated withdrawal rate implies, how long the measured
 * capacity takes to reach it, and what the drawdown looks like net of tax.
 *
 * **The withdrawal rate sits beside every figure it produced** — design §10,
 * taken literally, because 4 % and 3,5 % give targets a quarter apart and a
 * reader shown only the euro amount cannot tell which they are looking at.
 *
 * The timeline's refusal is the ENGINE's own sentence, printed verbatim: three
 * different causes share `months_to_independence: null` (unmeasurable capacity,
 * a capacity that is negative or zero, a target beyond the fifty-year bound)
 * and only the engine knows which applies. Restating it here in this
 * component's own words is how a screen ends up naming the wrong cause.
 */
export function FirePanel({ fire }: { fire: FireProjection }) {
  const { target, independence, retirement } = fire;

  return (
    <div className="yd-fire">
      <div className="yd-fire__target">
        <p className="yd-fire__target-label">Capital visé pour l'indépendance</p>
        <p className="yd-fire__target-value">{formatCents(target.target_capital_cents)}</p>
        <p className="yd-projection__note">
          Vos dépenses annuelles mesurées ({formatCents(target.annual_expenses_cents)}) divisées
          par un taux de retrait de <strong>{formatRateBps(target.withdrawal_rate_bps)}</strong> —
          la « règle des 4 % » appliquée au taux que vous avez déclaré, jamais à un taux que
          Yieldo choisirait pour vous.
        </p>
      </div>

      <div className="yd-fire__timeline" data-testid="yd-fire-timeline">
        <p className="yd-projection__section-title">Délai vers l'indépendance</p>
        {independence.unavailable_reason !== null ? (
          <p className="yd-projection__refusal">{independence.unavailable_reason}</p>
        ) : (
          <>
            <p className="yd-fire__timeline-value">
              {monthsSentence(independence.months_to_independence ?? 0)}
            </p>
            <p className="yd-projection__note">
              Atteint le{" "}
              <strong>
                {independence.independent_on === null
                  ? "—"
                  : frenchDate(independence.independent_on)}
              </strong>
              , en partant de {formatCents(independence.current_capital_cents)} et en capitalisant
              à {formatRateBps(independence.annual_return_bps)} par an.
            </p>
          </>
        )}
        {independence.capacity !== null ? (
          <p className="yd-projection__note">
            Capacité d'épargne mesurée&nbsp;:{" "}
            <strong
              className={
                independence.capacity.median_cents < 0
                  ? "yd-projection__figure--negative"
                  : "yd-projection__figure--positive"
              }
            >
              {formatCents(independence.capacity.median_cents, { signed: true })} par mois
            </strong>{" "}
            sur {independence.capacity.months} mois de relevés, entre{" "}
            {formatCents(independence.capacity.low_cents, { signed: true })} et{" "}
            {formatCents(independence.capacity.high_cents, { signed: true })} d'un mois à l'autre.
          </p>
        ) : null}
      </div>

      <div className="yd-fire__drawdown" data-testid="yd-fire-drawdown">
        <p className="yd-projection__section-title">Phase de retrait</p>
        {retirement === null ? (
          <p className="yd-projection__refusal">{fire.retirement_unavailable_reason}</p>
        ) : (
          <>
            <ul className="yd-fire__rows">
              <Row
                label="Retrait mensuel brut"
                value={formatCents(retirement.points[0]?.gross_withdrawal_cents ?? 0)}
                note={`${formatRateBps(retirement.withdrawal_rate_bps)} du capital de départ, réparti sur douze mois et tenu constant`}
              />
              <Row
                label="Net d'impôt, le premier mois"
                value={formatCents(retirement.points[0]?.net_withdrawal_cents ?? 0)}
                note={`Régime appliqué : ${REGIME_NAMES[retirement.tax_regime] ?? retirement.tax_regime}${
                  retirement.marginal_rate_bps === null
                    ? ""
                    : ` à ${formatRateBps(retirement.marginal_rate_bps)}`
                }. Seule la part de plus-value du retrait est imposée, jamais le retour de votre propre capital.`}
              />
              <Row
                label={retirement.exhausted_at_month === null ? "Tient l'horizon" : "Capital épuisé"}
                value={
                  retirement.exhausted_at_month === null
                    ? `${monthsSentence(retirement.months)} et plus`
                    : `au bout de ${monthsSentence(retirement.exhausted_at_month)}`
                }
                note={
                  retirement.exhausted_at_month === null
                    ? `Le capital n'est pas épuisé avant la fin de l'horizon demandé (${retirement.months} mois). Au-delà, rien n'est projeté.`
                    : "Le retrait est ramené à ce qui reste le dernier mois : un ménage ne dépense pas un euro que le compte ne détient pas."
                }
              />
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <li className="yd-fire__row">
      <span className="yd-fire__row-label">{label}</span>
      <span className="yd-fire__row-value">{value}</span>
      <span className="yd-fire__row-note">{note}</span>
    </li>
  );
}
