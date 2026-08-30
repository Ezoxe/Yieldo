import { formatCents } from "../../design/theme";
import type { Impact } from "../../lib/types";

/**
 * A runway in months, in the words its own value has earned.
 *
 * `0.0` is a real measurement — a balance already at or below zero — and
 * printing "0,0 mois" reads as a measurement of nothing rather than as an
 * emergency fund that is already gone. It is the operator's own value, before
 * AND after the purchase.
 */
export function runwayLabel(months: number): string {
  if (months <= 0) return "déjà épuisé";
  const rounded = months.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${rounded} mois`;
}

interface ImpactPanelProps {
  impact: Impact;
  /** The purchase price, because the emergency comparison removes the WHOLE
   *  price and the screen has to say so. */
  targetCents: number;
  downPaymentCents: number;
}

export function ImpactPanel({ impact, targetCents, downPaymentCents }: ImpactPanelProps) {
  const emergency = impact.emergency;
  const bothExhausted =
    emergency.runway_months_before !== null &&
    emergency.runway_months_after !== null &&
    emergency.runway_months_before <= 0 &&
    emergency.runway_months_after <= 0;

  return (
    <div className="yd-impact">
      <div className="yd-impact__block">
        <h3 className="yd-impact__title">Fonds d'urgence</h3>
        {emergency.unavailable_reason !== null ? (
          <p className="yd-feas__refusal">{emergency.unavailable_reason}</p>
        ) : bothExhausted ? (
          // One sentence, not two identical figures: "0,0 mois → 0,0 mois" is a
          // comparison of nothing with nothing.
          <p className="yd-impact__sentence" data-testid="yd-impact-emergency">
            Déjà épuisé avant comme après : votre solde est en dessous de zéro, il n'y a donc
            aucune autonomie que cet achat puisse réduire — elle est déjà nulle.
          </p>
        ) : (
          <div className="yd-impact__pair" data-testid="yd-impact-emergency">
            <div className="yd-impact__side">
              <span className="yd-impact__side-label">Sans cet achat</span>
              <span className="yd-impact__side-value">
                {runwayLabel(emergency.runway_months_before ?? 0)}
              </span>
            </div>
            <span className="yd-impact__arrow" aria-hidden="true">
              →
            </span>
            <div className="yd-impact__side">
              <span className="yd-impact__side-label">Avec cet achat</span>
              <span className="yd-impact__side-value">
                {runwayLabel(emergency.runway_months_after ?? 0)}
              </span>
            </div>
          </div>
        )}
        <p className="yd-impact__note">
          {`La comparaison retire le prix entier — ${formatCents(targetCents)} — de votre solde, et jamais le prix moins l'apport.`}
          {downPaymentCents > 0
            ? ` Votre apport de ${formatCents(downPaymentCents)} est un montant déclaré, sans compte derrière lui : le déduire supposerait qu'il dort déjà quelque part que ce solde ne compte pas.`
            : " Un apport est un montant déclaré, sans compte derrière lui : le déduire supposerait qu'il dort déjà quelque part que ce solde ne compte pas."}
        </p>
      </div>

      <div className="yd-impact__block">
        <h3 className="yd-impact__title">Vos liquidités dans cinq ans</h3>
        {impact.liquid_unavailable_reason !== null ? (
          <p className="yd-feas__refusal">{impact.liquid_unavailable_reason}</p>
        ) : (
          <div className="yd-impact__pair" data-testid="yd-impact-liquid">
            <div className="yd-impact__side">
              <span className="yd-impact__side-label">Sans cet achat</span>
              <span
                className={`yd-impact__side-value${
                  (impact.liquid_in_five_years_before_cents ?? 0) < 0
                    ? " yd-impact__side-value--negative"
                    : ""
                }`}
              >
                {formatCents(impact.liquid_in_five_years_before_cents ?? 0, { signed: true })}
              </span>
            </div>
            <span className="yd-impact__arrow" aria-hidden="true">
              →
            </span>
            <div className="yd-impact__side">
              <span className="yd-impact__side-label">Avec cet achat</span>
              <span
                className={`yd-impact__side-value${
                  (impact.liquid_in_five_years_after_cents ?? 0) < 0
                    ? " yd-impact__side-value--negative"
                    : ""
                }`}
              >
                {formatCents(impact.liquid_in_five_years_after_cents ?? 0, { signed: true })}
              </span>
            </div>
          </div>
        )}
        <p className="yd-impact__note">
          Une trajectoire de liquidités : votre solde projeté au rythme d'épargne mesuré, sur cinq
          ans. Ce n'est pas un patrimoine — voir ci-dessous.
        </p>
      </div>

      {/* Design §6.3 item 7 names three components and this phase ships two.
          Stated outright, because a blank panel or a zero would be worse than
          saying it. `ImpactOut` deliberately carries no field for either, so no
          later task can quietly fill one with a placeholder. */}
      <p className="yd-impact__absent" data-testid="yd-impact-absent">
        Le patrimoine net à cinq ans et le score de santé financière ne sont pas encore calculés :
        les comptes d'investissement arrivent avec la phase Patrimoine, et le score de santé avec
        les mécaniques de suivi. Rien n'est affiché à leur place — un zéro se lirait comme une
        mesure.
      </p>
    </div>
  );
}
